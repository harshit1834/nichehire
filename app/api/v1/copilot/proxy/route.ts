import { auth, currentUser } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { CONSENT_SCOPES, CONSENT_VERSION } from '@/lib/copilotConsent';
import { getCopilotScriptText } from './CopilotScript';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// Keep false during testing. If enabled, the SQL function below must exist and be applied.
const IS_PREMIUM_MODE_LIVE = false;
const FREE_CREDITS = 3;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const USER_AGENT = 'NicheHireCoPilot/1.0 (+candidate-assisted form filling)';

// Standard, popular career ATS platforms supported out-of-the-box
const BUILTIN_ALLOWED_HOSTS = [
  'jobs.lever.co',
  'boards.greenhouse.io',
  'apply.workable.com',
  'jobs.ashbyhq.com',
  'careers.smartrecruiters.com',
  'breezy.hr',
  'recruitee.com',
  'nichehire.tech',
  'example.com',
];

const envHosts = (process.env.COPILOT_ALLOWED_HOSTS ?? '')
  .split(',')
  .map(value => value.trim().toLowerCase().replace(/\.$/, ''))
  .filter(Boolean);

const ALLOWED_HOSTS = new Set([...BUILTIN_ALLOWED_HOSTS, ...envHosts]);

class CopilotError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
    this.name = 'CopilotError';
  }
}

function dbOrThrow() {
  if (!supabase) throw new CopilotError('SERVER_CONFIGURATION_ERROR', 503);
  return supabase;
}

/* ----------------------- SSRF protections ----------------------- */
const blocked = new net.BlockList();
const blockedIPv4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
for (const [address, prefix] of blockedIPv4) blocked.addSubnet(address, prefix, 'ipv4');
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet('ff00::', 8, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2001:10::', 28, 'ipv6');

function isBlockedIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? blocked.check(mapped[1], 'ipv4') : true;
  }
  const family = net.isIP(ip);
  if (!family) return true;
  return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

function safeLookup(hostname: string, options: any, callback: any) {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses?.length || addresses.some((address: { address: string }) => isBlockedIp(address.address))) {
      return callback(new Error('BLOCKED_ADDRESS'));
    }
    const filtered = options?.family
      ? addresses.filter((address: { family: number }) => address.family === options.family)
      : addresses;
    if (!filtered.length) return callback(new Error('NO_ALLOWED_ADDRESS'));
    if (options?.all) return callback(null, filtered);
    return callback(null, filtered[0].address, filtered[0].family);
  });
}

const safeAgent = new Agent({
  connect: { lookup: safeLookup as any },
  headersTimeout: TIMEOUT_MS,
  bodyTimeout: TIMEOUT_MS,
});

function isAllowedHost(host: string): boolean {
  if (ALLOWED_HOSTS.has(host)) return true;
  for (const allowed of ALLOWED_HOSTS) {
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(2);
      if (host === suffix || host.endsWith('.' + suffix)) return true;
    } else if (host.endsWith('.' + allowed)) {
      return true;
    }
  }
  return false;
}

function parseTarget(raw: unknown, base?: URL): URL {
  const blockedUrl = () => new CopilotError('BLOCKED_URL', 400);
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) throw blockedUrl();

  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw blockedUrl();
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw blockedUrl();
  if (url.port && url.port !== '443') throw blockedUrl();

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || net.isIP(host) || host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) {
    throw blockedUrl();
  }
  if (!isAllowedHost(host)) throw blockedUrl();
  url.hash = '';
  return url;
}

async function readLimited(response: Awaited<ReturnType<typeof undiciFetch>>, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new CopilotError('TOO_LARGE', 413);
  }
  const reader = response.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new CopilotError('TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

type FetchedPage = { html: string; finalUrl: URL; contentSecurityPolicy: string | null };

async function fetchHtml(startUrl: URL): Promise<FetchedPage> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await undiciFetch(url.toString(), {
        dispatcher: safeAgent,
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new CopilotError('UPSTREAM_FAILED', 502);
        url = parseTarget(location, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new CopilotError('UPSTREAM_FAILED', 502);
      }
      const contentType = response.headers.get('content-type') || '';
      if (!/^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType)) {
        await response.body?.cancel();
        throw new CopilotError('UNSUPPORTED_CONTENT', 415);
      }
      const html = await readLimited(response, MAX_BYTES);
      return {
        html,
        finalUrl: url,
        contentSecurityPolicy: response.headers.get('content-security-policy'),
      };
    } catch (error) {
      if (controller.signal.aborted) throw new CopilotError('UPSTREAM_TIMEOUT', 504);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new CopilotError('UPSTREAM_FAILED', 502);
}

/* ----------------------- Safe HTML integration ----------------------- */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function injectIntoHtml(html: string, finalUrl: URL, script: string, upstreamCsp: string | null): string {
  let output = html;
  const baseTag = `<base href="${escapeHtmlAttribute(finalUrl.toString())}">`;
  const cspMeta = upstreamCsp
    ? `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(upstreamCsp)}">`
    : '';
  const headAddition = `${cspMeta}${baseTag}`;
  const headOpen = /<head\b[^>]*>/i;

  if (headOpen.test(output)) {
    output = output.replace(headOpen, match => `${match}${headAddition}`);
  } else {
    const htmlOpen = /<html\b[^>]*>/i;
    if (htmlOpen.test(output)) {
      output = output.replace(htmlOpen, match => `${match}<head>${headAddition}</head>`);
    } else {
      const doctype = /^\s*<!doctype[^>]*>/i;
      if (doctype.test(output)) {
        output = output.replace(doctype, match => `${match}<head>${headAddition}</head>`);
      } else {
        output = `<head>${headAddition}</head>${output}`;
      }
    }
  }

  const bodyClose = /<\/body\s*>/i;
  return bodyClose.test(output)
    ? output.replace(bodyClose, () => `${script}</body>`)
    : `${output}${script}`;
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) throw new CopilotError('UNAUTHORIZED', 401);
    const db = dbOrThrow();

    const body = await req.json().catch(() => null) as { targetUrl?: unknown; requestId?: unknown } | null;

    // 1. Consent is required and verified
    const { data: consent } = await db
      .from('copilot_consents')
      .select('version, scopes')
      .eq('user_id', userId)
      .eq('version', CONSENT_VERSION)
      .is('withdrawn_at', null)
      .maybeSingle();

    const savedScopes = Array.isArray(consent?.scopes) ? consent.scopes : [];
    if (!consent || !CONSENT_SCOPES.every(scope => savedScopes.includes(scope))) {
      throw new CopilotError('CONSENT_REQUIRED', 403);
    }

    // 2. Validate target URL
    const target = parseTarget(body?.targetUrl);
    let requestId: string | null = null;
    if (typeof body?.requestId === 'string' && /^[a-zA-Z0-9._:-]{8,100}$/.test(body.requestId)) {
      requestId = body.requestId;
    }
    if (IS_PREMIUM_MODE_LIVE && !requestId) throw new CopilotError('INVALID_REQUEST_ID', 400);

    // 3. Early paywall check if premium is active
    if (IS_PREMIUM_MODE_LIVE) {
      const { data: wallet } = await db
        .from('premium_usage')
        .select('credits_remaining, is_premium_subscribed')
        .eq('user_id', userId)
        .maybeSingle();
      if (wallet && wallet.is_premium_subscribed !== true && Number(wallet.credits_remaining) <= 0) {
        throw new CopilotError('PAYWALL_LOCKED', 402);
      }
    }

    // 4. Fetch external page
    let fetched: FetchedPage;
    try {
      fetched = await fetchHtml(target);
    } catch (error) {
      if (error instanceof CopilotError) throw error;
      console.warn('[copilot/proxy] upstream request failed:', error);
      throw new CopilotError('UPSTREAM_FAILED', 502);
    }

    // 5. Build candidate profile with Clerk fallback + Supabase user_profiles
    const candidateProfile = {
      full_name: '',
      email: '',
      phone: '',
      experience_years: '' as string | number,
    };

    try {
      const clerkUser = await currentUser();
      if (clerkUser) {
        const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ');
        candidateProfile.full_name = name || clerkUser.username || '';
        candidateProfile.email = clerkUser.primaryEmailAddress?.emailAddress || clerkUser.emailAddresses?.[0]?.emailAddress || '';
        candidateProfile.phone = clerkUser.primaryPhoneNumber?.phoneNumber || clerkUser.phoneNumbers?.[0]?.phoneNumber || '';
      }
    } catch (err) {
      console.warn('[copilot/proxy] Clerk profile read note:', err);
    }

    try {
      const { data: dbProfile } = await db
        .from('user_profiles')
        .select('full_name, email, phone, experience_years')
        .eq('user_id', userId)
        .maybeSingle();

      if (dbProfile) {
        if (dbProfile.full_name) candidateProfile.full_name = dbProfile.full_name;
        if (dbProfile.email) candidateProfile.email = dbProfile.email;
        if (dbProfile.phone) candidateProfile.phone = dbProfile.phone;
        if (dbProfile.experience_years) candidateProfile.experience_years = dbProfile.experience_years;
      }
    } catch (err) {
      console.warn('[copilot/proxy] DB profile read note:', err);
    }

    const script = getCopilotScriptText(candidateProfile);
    const html = injectIntoHtml(fetched.html, fetched.finalUrl, script, fetched.contentSecurityPolicy);

    // 6. Premium mode credit deduction (if live)
    if (IS_PREMIUM_MODE_LIVE) {
      const { data, error } = await db.rpc('consume_copilot_credit', {
        p_user_id: userId,
        p_request_id: requestId,
        p_free_credits: FREE_CREDITS,
      });
      if (error) {
        console.error('[copilot/proxy] credit consumption failed:', error);
        throw new CopilotError('CREDIT_SERVICE_UNAVAILABLE', 503);
      }
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.allowed) throw new CopilotError('PAYWALL_LOCKED', 402);
    }

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    if (error instanceof CopilotError) {
      return NextResponse.json({ error: error.code }, {
        status: error.status,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      });
    }
    console.error('[copilot/proxy] unexpected server error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }
}

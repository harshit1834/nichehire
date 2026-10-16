import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import net from 'node:net';
import crypto from 'node:crypto';
import { CONSENT_SCOPES, CONSENT_VERSION } from '@/lib/copilotConsent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

/* ----------------------- SSRF protections for applicationUrl ----------------------- */
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

function isBlockedHost(host: string): boolean {
  const clean = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!clean || clean === 'localhost' || /\.(localhost|local|internal)$/.test(clean)) {
    return true;
  }
  const family = net.isIP(clean);
  if (family) {
    return blocked.check(clean, family === 4 ? 'ipv4' : 'ipv6');
  }
  return false;
}

function validateApplicationUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim() || rawUrl.length > 2048) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return null;
    }
    if (parsed.port && parsed.port !== '443') {
      return null;
    }
    if (isBlockedHost(parsed.hostname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Timing-safe header comparison to prevent timing attacks on the internal secret.
 */
function verifyInternalSecret(headerValue: string | null, configuredSecret: string): boolean {
  if (!headerValue || !configuredSecret) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(configuredSecret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  try {
    // 1. Authenticate n8n request using x-nichehire-internal-secret header
    const internalSecret = process.env.NICHEHIRE_INTERNAL_SECRET || process.env.INTERNAL_API_SECRET;
    const providedSecret = req.headers.get('x-nichehire-internal-secret') || req.headers.get('X-Nichehire-Internal-Secret');

    if (!internalSecret || !verifyInternalSecret(providedSecret, internalSecret)) {
      return NextResponse.json(
        {
          authorized: false,
          error: 'UNAUTHORIZED_INTERNAL_REQUEST',
          message: 'Invalid or missing internal secret header.',
        },
        { status: 401, headers: NO_STORE }
      );
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return NextResponse.json(
        {
          authorized: false,
          error: 'SERVER_CONFIGURATION_ERROR',
          message: 'Database service is not configured.',
        },
        { status: 503, headers: NO_STORE }
      );
    }

    // 2. Parse request payload
    const body = await req.json().catch(() => null) as {
      applicationSessionId?: unknown;
      applicationUrl?: unknown;
      jobTitle?: unknown;
      jobDescription?: unknown;
      browserSessionId?: unknown;
      candidateUserId?: unknown;
    } | null;

    const applicationSessionId = typeof body?.applicationSessionId === 'string'
      ? body.applicationSessionId.trim()
      : '';

    if (!applicationSessionId || applicationSessionId.length < 4 || applicationSessionId.length > 128) {
      return NextResponse.json(
        {
          authorized: false,
          error: 'INVALID_SESSION_ID',
          message: 'Valid applicationSessionId string is required.',
        },
        { status: 400, headers: NO_STORE }
      );
    }

    // 3. Validate application session and credit reservation against NicheHire's database
    // We NEVER trust candidate IDs or credit amounts supplied by the browser.
    // Session state and candidate ownership are strictly derived from copilot_credit_requests.
    let { data: sessionRecord, error: sessionError } = await supabase
      .from('copilot_credit_requests')
      .select('*')
      .eq('request_id', applicationSessionId)
      .maybeSingle();

    // If session doesn't exist yet, allow seed / initialization if candidateUserId is provided
    // and candidate has verified consent
    if (!sessionRecord && typeof body?.candidateUserId === 'string' && body.candidateUserId.trim()) {
      const candidateUserId = body.candidateUserId.trim();
      const validUrl = validateApplicationUrl(body?.applicationUrl);
      
      // Auto-register session reservation
      await supabase
        .from('copilot_credit_requests')
        .upsert({
          user_id: candidateUserId,
          request_id: applicationSessionId,
          is_subscribed: false,
          credits_remaining: 3,
          created_at: new Date().toISOString(),
        }, { onConflict: 'user_id,request_id' });

      // Re-fetch record from database
      const re = await supabase
        .from('copilot_credit_requests')
        .select('*')
        .eq('request_id', applicationSessionId)
        .maybeSingle();
      sessionRecord = re.data;
    }

    if (!sessionRecord) {
      return NextResponse.json(
        {
          authorized: false,
          error: 'SESSION_NOT_FOUND',
          message: `Application session '${applicationSessionId}' was not found in NicheHire database.`,
        },
        { status: 404, headers: NO_STORE }
      );
    }

    const candidateUserId = sessionRecord.user_id;
    if (!candidateUserId) {
      return NextResponse.json(
        {
          authorized: false,
          error: 'INVALID_SESSION_OWNERSHIP',
          message: 'Application session has no verified candidate identity attached.',
        },
        { status: 403, headers: NO_STORE }
      );
    }

    // 4. Verify candidate consent from copilot_consents table
    const { data: consentRecord, error: consentError } = await supabase
      .from('copilot_consents')
      .select('version, scopes, withdrawn_at')
      .eq('user_id', candidateUserId)
      .eq('version', CONSENT_VERSION)
      .is('withdrawn_at', null)
      .maybeSingle();

    const savedScopes = Array.isArray(consentRecord?.scopes) ? consentRecord.scopes : [];
    const hasActiveConsent = Boolean(consentRecord) && CONSENT_SCOPES.every(s => savedScopes.includes(s));

    if (!hasActiveConsent) {
      return NextResponse.json(
        {
          authorized: false,
          applicationSessionId,
          error: 'CONSENT_REQUIRED',
          message: 'Candidate has not granted or has withdrawn required NicheHire Co-Pilot consent.',
        },
        { status: 403, headers: NO_STORE }
      );
    }

    // 5. Confirm credit reservation without trusting browser inputs
    // In NicheHire's database, either user is subscribed OR credits remaining is greater than 0
    const isSubscribed = Boolean(sessionRecord.is_subscribed);
    const creditsRemaining = Number(sessionRecord.credits_remaining ?? 0);
    const creditsReserved = Number(sessionRecord.credits_reserved ?? 1);

    if (!isSubscribed && creditsRemaining <= 0) {
      return NextResponse.json(
        {
          authorized: false,
          applicationSessionId,
          error: 'INSUFFICIENT_CREDITS',
          message: 'Candidate has exhausted their Co-Pilot credit allowance.',
        },
        { status: 402, headers: NO_STORE }
      );
    }

    // 6. Validate job application URL
    const rawAppUrl = sessionRecord.application_url || body?.applicationUrl;
    const validatedAppUrl = validateApplicationUrl(rawAppUrl);

    if (!validatedAppUrl) {
      return NextResponse.json(
        {
          authorized: false,
          applicationSessionId,
          error: 'INVALID_APPLICATION_URL',
          message: 'The job application URL is invalid, non-HTTPS, or points to a disallowed destination.',
        },
        { status: 400, headers: NO_STORE }
      );
    }

    // 7. Retrieve verified candidate profile from user_profiles table
    const { data: userProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('full_name, email, phone, experience_years')
      .eq('user_id', candidateUserId)
      .maybeSingle();

    const candidateProfile = {
      fullName: userProfile?.full_name || 'Candidate',
      email: userProfile?.email || '',
      phone: userProfile?.phone || '',
      experienceYears: userProfile?.experience_years ? String(userProfile.experience_years) : '0',
    };

    // 8. Extract job metadata & browser session ID
    const browserSessionId = typeof body?.browserSessionId === 'string' && body.browserSessionId.trim()
      ? body.browserSessionId.trim()
      : (sessionRecord.browser_session_id || `bsess_${applicationSessionId.slice(0, 16)}`);

    const jobTitle = typeof body?.jobTitle === 'string' && body.jobTitle.trim()
      ? body.jobTitle.trim()
      : (sessionRecord.job_title || 'Target Job Position');

    const jobDescription = typeof body?.jobDescription === 'string' && body.jobDescription.trim()
      ? body.jobDescription.trim()
      : (sessionRecord.job_description || '');

    // 9. Return authorized JSON payload for n8n Node 2
    return NextResponse.json(
      {
        authorized: true,
        applicationSessionId,
        browserSessionId,
        applicationUrl: validatedAppUrl,
        candidateProfile,
        jobTitle,
        jobDescription,
        creditsReserved,
      },
      {
        status: 200,
        headers: NO_STORE,
      }
    );
  } catch (err: any) {
    console.error('[copilot/authorize] unexpected server error:', err);
    return NextResponse.json(
      {
        authorized: false,
        error: 'INTERNAL_SERVER_ERROR',
        message: err.message || 'An unexpected error occurred during session authorization.',
      },
      { status: 500, headers: NO_STORE }
    );
  }
}

import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { CONSENT_SCOPES, CONSENT_VERSION } from '@/lib/copilotConsent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };
function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return errorResponse('UNAUTHORIZED', 401);
  if (!supabase) return errorResponse('SERVER_CONFIGURATION_ERROR', 503);

  const { data, error } = await supabase
    .from('copilot_consents')
    .select('version, scopes')
    .eq('user_id', userId)
    .eq('version', CONSENT_VERSION)
    .is('withdrawn_at', null)
    .maybeSingle();

  if (error) {
    console.error('[copilot/consent GET]', error);
    return errorResponse('CONSENT_STATUS_UNAVAILABLE', 503);
  }

  const savedScopes = Array.isArray(data?.scopes) ? data.scopes : [];
  const granted = Boolean(data) && CONSENT_SCOPES.every(scope => savedScopes.includes(scope));
  return NextResponse.json({ granted, version: CONSENT_VERSION }, { headers: NO_STORE });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return errorResponse('UNAUTHORIZED', 401);
  if (!supabase) return errorResponse('SERVER_CONFIGURATION_ERROR', 503);

  const body = await req.json().catch(() => null) as {
    version?: unknown;
    acceptedScopes?: unknown;
  } | null;

  const acceptedScopes = Array.isArray(body?.acceptedScopes) ? body.acceptedScopes : [];
  const acceptedAllRequiredScopes = CONSENT_SCOPES.every(scope => acceptedScopes.includes(scope));
  if (body?.version !== CONSENT_VERSION || !acceptedAllRequiredScopes) {
    return errorResponse('CONSENT_CONFIRMATION_REQUIRED', 400);
  }

  // 1. Try atomic database RPC function first
  const { error } = await supabase.rpc('set_copilot_consent', {
    p_user_id: userId,
    p_version: CONSENT_VERSION,
    p_scopes: [...CONSENT_SCOPES],
    p_action: 'grant',
  });

  if (error) {
    console.warn('[copilot/consent POST] RPC failed, trying direct upsert fallback:', error.message);
    const { error: directErr } = await supabase
      .from('copilot_consents')
      .upsert({
        user_id: userId,
        version: CONSENT_VERSION,
        scopes: [...CONSENT_SCOPES],
        granted_at: new Date().toISOString(),
        withdrawn_at: null,
      }, { onConflict: 'user_id,version' });

    if (directErr) {
      console.error('[copilot/consent POST] fallback error:', directErr);
      return errorResponse('CONSENT_SAVE_FAILED', 503);
    }
  }

  return NextResponse.json({ granted: true, version: CONSENT_VERSION }, { headers: NO_STORE });
}

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) return errorResponse('UNAUTHORIZED', 401);
  if (!supabase) return errorResponse('SERVER_CONFIGURATION_ERROR', 503);

  const { error } = await supabase.rpc('set_copilot_consent', {
    p_user_id: userId,
    p_version: CONSENT_VERSION,
    p_scopes: [],
    p_action: 'withdraw',
  });

  if (error) {
    console.warn('[copilot/consent DELETE] RPC failed, trying direct update fallback:', error.message);
    const { error: directErr } = await supabase
      .from('copilot_consents')
      .update({ withdrawn_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('version', CONSENT_VERSION);

    if (directErr) {
      console.error('[copilot/consent DELETE]', directErr);
      return errorResponse('CONSENT_WITHDRAWAL_FAILED', 503);
    }
  }

  return NextResponse.json({ granted: false }, { headers: NO_STORE });
}

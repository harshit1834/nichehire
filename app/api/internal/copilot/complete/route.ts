import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

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

function verifyInternalSecret(headerValue: string | null, configuredSecret: string): boolean {
  if (!headerValue || !configuredSecret) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(configuredSecret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  try {
    const internalSecret = process.env.NICHEHIRE_INTERNAL_SECRET || process.env.INTERNAL_API_SECRET;
    const providedSecret = req.headers.get('x-nichehire-internal-secret') || req.headers.get('X-Nichehire-Internal-Secret');

    if (!internalSecret || !verifyInternalSecret(providedSecret, internalSecret)) {
      return NextResponse.json(
        {
          success: false,
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
          success: false,
          error: 'SERVER_CONFIGURATION_ERROR',
          message: 'Database service is not configured.',
        },
        { status: 503, headers: NO_STORE }
      );
    }

    const body = await req.json().catch(() => null) as {
      applicationSessionId?: unknown;
      submissionStatus?: unknown;
      confirmationDetails?: unknown;
    } | null;

    const applicationSessionId = typeof body?.applicationSessionId === 'string'
      ? body.applicationSessionId.trim()
      : '';

    if (!applicationSessionId || applicationSessionId.length < 4 || applicationSessionId.length > 128) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_SESSION_ID',
          message: 'Valid applicationSessionId string is required.',
        },
        { status: 400, headers: NO_STORE }
      );
    }

    // Fetch existing session reservation
    const { data: sessionRecord, error: sessionError } = await supabase
      .from('copilot_credit_requests')
      .select('*')
      .eq('request_id', applicationSessionId)
      .maybeSingle();

    if (!sessionRecord) {
      return NextResponse.json(
        {
          success: false,
          error: 'SESSION_NOT_FOUND',
          message: `Application session '${applicationSessionId}' was not found.`,
        },
        { status: 404, headers: NO_STORE }
      );
    }

    const isSubscribed = Boolean(sessionRecord.is_subscribed);
    let currentCredits = Number(sessionRecord.credits_remaining ?? 3);
    const creditsReserved = Number(sessionRecord.credits_reserved ?? 1);

    // If candidate is not on unlimited subscription, finalize credit deduction
    let newCreditsRemaining = currentCredits;
    if (!isSubscribed) {
      newCreditsRemaining = Math.max(0, currentCredits - creditsReserved);
      await supabase
        .from('copilot_credit_requests')
        .update({
          credits_remaining: newCreditsRemaining,
        })
        .eq('request_id', applicationSessionId);
    }

    return NextResponse.json(
      {
        success: true,
        applicationSessionId,
        status: 'completed',
        isSubscribed,
        creditsDeducted: isSubscribed ? 0 : creditsReserved,
        creditsRemaining: newCreditsRemaining,
        completedAt: new Date().toISOString(),
      },
      {
        status: 200,
        headers: NO_STORE,
      }
    );
  } catch (err: any) {
    console.error('[copilot/complete] unexpected server error:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'INTERNAL_SERVER_ERROR',
        message: err.message || 'An unexpected error occurred during credit settlement.',
      },
      { status: 500, headers: NO_STORE }
    );
  }
}

-- ==============================================================================
-- NicheHire Co-Pilot Database Schema & Consents Migration
-- ==============================================================================

-- 1. Ensure user_profiles has profile fields used by Co-Pilot autofill
ALTER TABLE IF EXISTS public.user_profiles
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS experience_years TEXT;

-- 2. Consents table: stores active and withdrawn user consents
CREATE TABLE IF NOT EXISTS public.copilot_consents (
  user_id      TEXT        NOT NULL,
  version      TEXT        NOT NULL,
  scopes       TEXT[]      NOT NULL,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, version)
);
ALTER TABLE public.copilot_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own copilot consents" ON public.copilot_consents;
CREATE POLICY "Users can read own copilot consents" ON public.copilot_consents
  FOR SELECT USING (auth.uid()::text = user_id OR auth.role() = 'service_role' OR auth.role() = 'anon');

DROP POLICY IF EXISTS "Users can manage own copilot consents" ON public.copilot_consents;
CREATE POLICY "Users can manage own copilot consents" ON public.copilot_consents
  FOR ALL USING (auth.uid()::text = user_id OR auth.role() = 'service_role' OR auth.role() = 'anon');

-- 3. Append-only audit history for regulatory compliance (DPDP / GDPR)
CREATE TABLE IF NOT EXISTS public.copilot_consent_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  version     TEXT        NOT NULL,
  action      TEXT        NOT NULL CHECK (action IN ('granted', 'withdrawn')),
  scopes      TEXT[]      NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.copilot_consent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own consent events" ON public.copilot_consent_events;
CREATE POLICY "Users can view own consent events" ON public.copilot_consent_events
  FOR SELECT USING (auth.uid()::text = user_id OR auth.role() = 'service_role');

-- 4. Idempotency records for Co-Pilot credit requests
CREATE TABLE IF NOT EXISTS public.copilot_credit_requests (
  user_id           TEXT        NOT NULL,
  request_id        TEXT        NOT NULL,
  is_subscribed     BOOLEAN     NOT NULL DEFAULT FALSE,
  credits_remaining INTEGER     NOT NULL DEFAULT 3,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, request_id)
);
ALTER TABLE public.copilot_credit_requests ENABLE ROW LEVEL SECURITY;

-- 5. Atomically update consent and append audit event
CREATE OR REPLACE FUNCTION public.set_copilot_consent(
  p_user_id TEXT,
  p_version TEXT,
  p_scopes TEXT[],
  p_action TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_consent RECORD;
  v_count INTEGER := 0;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' THEN
    RAISE EXCEPTION 'user id is required';
  END IF;

  IF p_action = 'grant' THEN
    IF p_version IS NULL OR p_version = '' OR p_scopes IS NULL OR cardinality(p_scopes) < 3 THEN
      RAISE EXCEPTION 'complete consent scopes are required';
    END IF;

    INSERT INTO public.copilot_consents (user_id, version, scopes, granted_at, withdrawn_at)
    VALUES (p_user_id, p_version, p_scopes, NOW(), NULL)
    ON CONFLICT (user_id, version) DO UPDATE
      SET scopes = EXCLUDED.scopes,
          granted_at = NOW(),
          withdrawn_at = NULL;

    INSERT INTO public.copilot_consent_events (user_id, version, action, scopes)
    VALUES (p_user_id, p_version, 'granted', p_scopes);
    RETURN 1;
  ELSIF p_action = 'withdraw' THEN
    FOR v_consent IN
      SELECT c.version, c.scopes
      FROM public.copilot_consents c
      WHERE c.user_id = p_user_id AND c.withdrawn_at IS NULL
      FOR UPDATE
    LOOP
      UPDATE public.copilot_consents
      SET withdrawn_at = NOW()
      WHERE user_id = p_user_id AND version = v_consent.version AND withdrawn_at IS NULL;

      INSERT INTO public.copilot_consent_events (user_id, version, action, scopes)
      VALUES (p_user_id, v_consent.version, 'withdrawn', COALESCE(v_consent.scopes, '{}'));
      v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
  ELSE
    RAISE EXCEPTION 'unsupported consent action';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_copilot_consent(TEXT, TEXT, TEXT[], TEXT) TO service_role, authenticated, anon;

-- ==============================================================================
-- NicheHire Internal Co-Pilot Session Authorization Migration
-- Extends copilot_credit_requests to track application URLs and session details
-- ==============================================================================

ALTER TABLE IF EXISTS public.copilot_credit_requests
  ADD COLUMN IF NOT EXISTS application_url TEXT,
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS job_description TEXT,
  ADD COLUMN IF NOT EXISTS browser_session_id TEXT,
  ADD COLUMN IF NOT EXISTS credits_reserved INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_authorized BOOLEAN DEFAULT TRUE;

-- Ensure service_role and internal handlers can read and manage sessions
GRANT ALL ON public.copilot_credit_requests TO service_role;

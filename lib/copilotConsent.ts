// Bump this version whenever the consent wording, data fields, or processing changes.
// A new version requires the candidate to consent again.
export const CONSENT_VERSION = '2026-10-v2';

// The server requires every scope below; the client cannot grant consent by version alone.
export const CONSENT_SCOPES = [
  'profile_autofill',
  'third_party_page_proxy',
  'candidate_review',
] as const;

export type ConsentScope = (typeof CONSENT_SCOPES)[number];

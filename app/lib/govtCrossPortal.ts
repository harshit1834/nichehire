import { VERIFIED_GOVT_EXAMS, GovtExam } from '../data/govtExamsData';
import {
  STATE_UT_PSC_DIRECTORIES,
  CENTRAL_RECRUITMENT_TIMETABLE,
  StateUtPscInfo,
  CentralRecruitmentExam,
} from '../data/govtCalendarData';

export interface GovtCrossPortalMatch {
  isGovtExam: boolean;
  query: string;
  matchedTitle: string;
  conductingBody: string;
  category: 'central' | 'state' | 'regional' | 'psu';
  targetUrl: string;
  examId?: string;
  officialPortalUrl?: string;
  advisoryNote: string;
}

/**
 * Normalizes user search query by stripping special punctuation, underscores,
 * hyphens, and collapsing extra whitespace.
 */
export function normalizeSearchQuery(query: string = ''): string {
  return query
    .replace(/[_+\-]+/g, ' ')
    .replace(/[^\w\s&]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Common government exam/recruitment tokens and acronyms recognized across India.
 * NOTE: This set is the GATE — a query must contain one of these to trigger govt detection.
 */
const KNOWN_GOVT_ACRONYMS = new Set([
  'upsc', 'ssc', 'cgl', 'chsl', 'mts', 'cpo',
  'rrb', 'ntpc', 'alp', 'ibps', 'sbi po', 'sbi clerk', 'rbi', 'rbi grade b',
  'nda', 'cds', 'afcat', 'capf', 'drdo', 'isro', 'nabard', 'sebi', 'sidbi',
  'mppsc', 'bpsc', 'uppsc', 'kpsc', 'tnpsc', 'mpsc', 'gpsc', 'appsc',
  'tspsc', 'rpsc', 'wbpsc', 'opsc', 'hpsc', 'ppsc', 'jkpsc', 'bssc',
  'upsssc', 'mppeb', 'vyapam', 'esb',
  'iocl', 'ongc', 'bpcl', 'hpcl', 'gail', 'sail', 'bhel', 'bel', 'hal',
  'coal india', 'aai', 'barc', 'npcil',
]);

/**
 * Explicit govt role/exam keywords (NOT acronyms) that confirm a govt intent.
 * Must appear in the query for the detector to fire on title/body matches.
 */
const GOVT_ROLE_KEYWORDS = new Set([
  'government', 'govt', 'sarkari', 'recruitment', 'vacancy', 'naukri',
  'constable', 'sub inspector', 'si ', 'ias', 'ips', 'ifs', 'irs',
  'pcs', 'psc', 'railway', 'railways', 'police', 'defence', 'army',
  'navy', 'airforce', 'air force', 'paramilitary', 'cisf', 'crpf', 'bsf',
  'itbp', 'ssb', 'ndrf', 'coast guard', 'para military',
  'bank po', 'bank clerk', 'bank exam', 'banking exam',
  'patwari', 'lekhpal', 'gram sachiv', 'gram sewak', 'anganwadi',
  'peon', 'chowkidar', 'home guard', 'forest guard',
  'clerk recruitment', 'clerk vacancy',
]);

/**
 * Returns true if the query contains at least one explicit govt indicator —
 * either a known acronym or a known govt role/exam keyword.
 * This is the MANDATORY gate before any title/body matching is attempted.
 */
function hasGovtIntent(clean: string, words: string[]): boolean {
  // Direct full-string acronym match
  if (KNOWN_GOVT_ACRONYMS.has(clean)) return true;

  // Single-word match against acronyms
  if (words.some((w) => KNOWN_GOVT_ACRONYMS.has(w))) return true;

  // Multi-word phrase match (e.g. "sbi po", "coal india")
  for (const acronym of KNOWN_GOVT_ACRONYMS) {
    if (acronym.includes(' ') && clean.includes(acronym)) return true;
  }

  // Role keyword match (any substring)
  for (const kw of GOVT_ROLE_KEYWORDS) {
    if (clean.includes(kw)) return true;
  }

  return false;
}

/**
 * Inspects a query from the private job search bar.
 * If it matches any verified government recruitment, public service commission (PSC),
 * central examination timetable, or PSU recruitment, returns structured cross-portal guidance.
 *
 * IMPORTANT: The function will NOT fire for generic queries like:
 *   - "Bahraich accountant"  → generic private job, no govt intent
 *   - "Indore engineer"      → geographic + generic, no govt intent
 *   - "Delhi manager"        → city + role, no govt intent
 * It WILL fire for:
 *   - "UPSC"                 → direct acronym
 *   - "SSC CGL preparation"  → acronym match
 *   - "railway constable"    → role keyword match
 *   - "MPPSC exam"           → state PSC acronym
 */
export function detectGovtCrossPortalSuggestion(
  rawQuery: string = ''
): GovtCrossPortalMatch | null {
  const clean = normalizeSearchQuery(rawQuery);
  if (!clean || clean.length < 2) return null;

  const words = clean.split(' ').filter(Boolean);

  // ─── MANDATORY GATE ──────────────────────────────────────────────────────────
  // Do NOT proceed unless query explicitly signals govt intent.
  // This prevents city names + generic roles from triggering the govt portal.
  if (!hasGovtIntent(clean, words)) return null;
  // ─────────────────────────────────────────────────────────────────────────────

  // 1. Check in VERIFIED_GOVT_EXAMS (Direct Active Openings)
  for (const exam of VERIFIED_GOVT_EXAMS) {
    const titleLow = normalizeSearchQuery(exam.title);
    const bodyLow = normalizeSearchQuery(exam.conductingBody);
    const idLow = exam.id.toLowerCase();

    const matchesTitle = titleLow.includes(clean) || clean.includes(titleLow);
    const matchesBody = bodyLow.includes(clean);
    const matchesId = idLow.includes(clean.replace(/\s+/g, '-'));
    const titleWords = titleLow.split(' ');
    const allWordsInTitle = words.length > 1 && words.every((w) => titleWords.includes(w));

    if (matchesTitle || matchesBody || matchesId || allWordsInTitle) {
      return {
        isGovtExam: true,
        query: rawQuery,
        matchedTitle: exam.title,
        conductingBody: exam.conductingBody,
        category: exam.category,
        targetUrl: `/govt-exams?q=${encodeURIComponent(rawQuery.trim())}`,
        examId: exam.id,
        officialPortalUrl: exam.officialLinks?.officialPortalUrl,
        advisoryNote: `"${rawQuery}" is an official government recruitment conducted by ${exam.conductingBody}. We track active gazette notifications, admit cards, and eligibility criteria on our dedicated Government Portal.`,
      };
    }
  }

  // 2. Check in STATE_UT_PSC_DIRECTORIES (All 36 States & UTs)
  for (const psc of STATE_UT_PSC_DIRECTORIES) {
    const pscCode = psc.shortCode.toLowerCase();
    const pscName = normalizeSearchQuery(psc.commissionName);

    if (
      clean === pscCode ||
      clean.includes(pscCode) ||
      pscName.includes(clean) ||
      psc.primaryExams.some((e) => normalizeSearchQuery(e).includes(clean))
    ) {
      return {
        isGovtExam: true,
        query: rawQuery,
        matchedTitle: `${psc.shortCode} State Competitive Examinations`,
        conductingBody: psc.commissionName,
        category: 'state',
        targetUrl: `/govt-exams?q=${encodeURIComponent(psc.shortCode)}`,
        officialPortalUrl: psc.officialWebsite,
        advisoryNote: `"${rawQuery}" is conducted by ${psc.commissionName} for ${psc.state} administrative and gazetted posts.`,
      };
    }
  }

  // 3. Check in CENTRAL_RECRUITMENT_TIMETABLE (UPSC, SSC, Railways, Banking)
  for (const central of CENTRAL_RECRUITMENT_TIMETABLE) {
    const titleLow = normalizeSearchQuery(central.title);
    const agencyLow = normalizeSearchQuery(central.agency);

    if (titleLow.includes(clean) || clean.includes(titleLow) || agencyLow.includes(clean)) {
      return {
        isGovtExam: true,
        query: rawQuery,
        matchedTitle: central.title,
        conductingBody: central.agency,
        category: 'central',
        targetUrl: `/govt-exams?q=${encodeURIComponent(rawQuery.trim())}`,
        examId: central.id,
        officialPortalUrl: central.officialPortal,
        advisoryNote: `"${rawQuery}" is an annual central recruitment cycle managed by ${central.agency}. Expected cycle: ${central.annualNotificationMonth}.`,
      };
    }
  }

  // 4. Fallback: query contains a recognized government acronym alone
  const matchedAcronym = Array.from(KNOWN_GOVT_ACRONYMS).find(
    (a) => a === clean || words.includes(a)
  );
  if (matchedAcronym) {
    const upperAcronym = matchedAcronym.toUpperCase();
    return {
      isGovtExam: true,
      query: rawQuery,
      matchedTitle: `${upperAcronym} Recruitment & Competitive Examination`,
      conductingBody: `${upperAcronym} Public Authority`,
      category: 'central',
      targetUrl: `/govt-exams?q=${encodeURIComponent(rawQuery.trim())}`,
      advisoryNote: `"${rawQuery}" appears to be a government competitive examination or commission (${upperAcronym}). Explore verified notifications on the Government Jobs portal.`,
    };
  }

  return null;
}

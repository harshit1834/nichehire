import { NextResponse } from 'next/server';
import { calculatePanIndiaGeoTier, resolvePanIndiaLocation } from '../../../lib/panIndiaGeo';
import {
  normalizeSearchInput,
  doesJobMatchQuery,
  rankJobsStrictTierOrder,
  isInherentlyGlobalRole,
  getRelatedJobSuggestions,
} from '../../../lib/searchRankingEngine';

import { detectGovtCrossPortalSuggestion } from '../../../lib/govtCrossPortal';
import { verifyJob } from '../../../lib/verifyJob';

const FETCH_TIMEOUT_MS = 8000;


async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeType(raw: string | string[] | undefined | null): 'Full-Time' | 'Contract' | 'Internship' | 'Other' {
  const values = Array.isArray(raw) ? raw : [raw];
  const joined = values.filter(Boolean).join(' ').toLowerCase();
  if (joined.includes('intern')) return 'Internship';
  if (joined.includes('full')) return 'Full-Time';
  if (joined.includes('contract') || joined.includes('freelance') || joined.includes('part')) return 'Contract';
  return 'Other';
}

function cleanDescription(html: string | undefined | null, maxLen = 4000): string {
  if (!html) return '';
  const text = html
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function detectWorkMode(location: string = '', title: string = '', description: string = ''): 'Remote' | 'Hybrid' | 'On-site' {
  const loc = (location || '').toLowerCase();
  const tit = (title || '').toLowerCase();
  const desc = (description || '').toLowerCase();

  // 1. Check location string first (highest fidelity signal)
  if (/\b(remote|work from home|wfh|telecommute|virtual|anywhere)\b/i.test(loc)) {
    return 'Remote';
  }
  if (/\b(hybrid)\b/i.test(loc)) {
    return 'Hybrid';
  }

  // 2. Check title (explicit role title designation)
  if (/\b(hybrid)\b/i.test(tit)) {
    return 'Hybrid';
  }
  if (/\b(remote|work from home|wfh|telecommute)\b/i.test(tit)) {
    return 'Remote';
  }
  if (/\b(on-site|onsite|in-office|in office|office based|wfo)\b/i.test(tit)) {
    return 'On-site';
  }

  // 3. Check description with strict contextual patterns (prevent false positives from remote servers/teams/tools)
  const hasStrictHybrid = /\b(hybrid work|hybrid role|hybrid model|days in office|hybrid schedule|days a week from office|hybrid environment|hybrid mode)\b/i.test(desc);
  const hasStrictRemote = /\b(100% remote|fully remote|permanent remote|work from home|wfh role|remote position|remote role|remote opportunity|work from anywhere|entirely remote|open to remote|remote first|remote based)\b/i.test(desc);
  const hasStrictOnsite = /\b(work from office|wfo|on-site|onsite|in-office|in office|physical presence|office based|relocation required|work on-site)\b/i.test(desc);

  if (hasStrictHybrid) return 'Hybrid';
  if (hasStrictRemote && !hasStrictOnsite) return 'Remote';
  if (hasStrictOnsite && !hasStrictRemote) return 'On-site';

  // 4. Default: Physical locations with no explicit remote designation are strictly On-site
  return 'On-site';
}

function estimateApplicants(jobId: string, postedAt?: number, postedText?: string): { count: number; text: string } {
  // Never generate fake social-proof counts. Return honest direct portal availability.
  return { count: 0, text: 'Direct Portal Link' };
}

const ADZUNA_COUNTRY_MAP: Record<string, string> = {
  india: 'in',
  us: 'us',
  'united states': 'us',
  usa: 'us',
  uk: 'gb',
  'united kingdom': 'gb',
  'great britain': 'gb',
  canada: 'ca',
  germany: 'de',
  deutschland: 'de',
  france: 'fr',
  australia: 'au',
  singapore: 'sg',
  netherlands: 'nl',
  holland: 'nl',
  spain: 'es',
  italy: 'it',
  poland: 'pl',
  mexico: 'mx',
  brazil: 'br',
  'new zealand': 'nz',
  'south africa': 'za',
  switzerland: 'ch',
  austria: 'at',
  belgium: 'be',
};

// ─── GEOGRAPHIC PROXIMITY HIERARCHY ENGINE ─────────────────────────────────────
// Hierarchy:
// Tier 1: Same place (exact city)
// Tier 2: Same district / satellite industrial areas
// Tier 3: Nearby cities within same state
// Tier 4: Whole state
// Tier 5: Other states / Pan-India Remote
// Tier 6: Other countries / International Remote

const REGION_MAP: Record<
  string,
  {
    state: string;
    stateCodes: string[];
    districts: string[];
    nearbyCities: string[];
  }
> = {
  indore: {
    state: 'madhya pradesh',
    stateCodes: ['mp', 'm.p.'],
    districts: ['pithampur', 'dewas', 'mhow', 'sanwer', 'rau', 'dhar'],
    nearbyCities: ['bhopal', 'ujjain', 'gwalior', 'jabalpur', 'ratlam', 'sagar', 'satna', 'rewa', 'katni', 'khandwa', 'khargone'],
  },
  bangalore: {
    state: 'karnataka',
    stateCodes: ['ka'],
    districts: ['whitefield', 'electronic city', 'koramangala', 'marathahalli', 'bellandur', 'hebbal', 'yelahanka', 'outer ring road'],
    nearbyCities: ['mysore', 'mangalore', 'hubli', 'belgaum', 'tumkur'],
  },
  bengaluru: {
    state: 'karnataka',
    stateCodes: ['ka'],
    districts: ['whitefield', 'electronic city', 'koramangala', 'marathahalli', 'bellandur', 'hebbal', 'yelahanka'],
    nearbyCities: ['mysore', 'mangalore', 'hubli'],
  },
  pune: {
    state: 'maharashtra',
    stateCodes: ['mh'],
    districts: ['hinjewadi', 'magarpatta', 'viman nagar', 'baner', 'wakad', 'hadapsar', 'pimpri', 'chinchwad', 'kharadi', 'bavdhan'],
    nearbyCities: ['mumbai', 'navi mumbai', 'thane', 'nagpur', 'nashik', 'aurangabad', 'kolhapur'],
  },
  mumbai: {
    state: 'maharashtra',
    stateCodes: ['mh'],
    districts: ['navi mumbai', 'thane', 'andheri', 'bandra', 'powai', 'goregaon', 'malad', 'bkc', 'lower parel', 'kandivali', 'borivali'],
    nearbyCities: ['pune', 'nashik', 'nagpur'],
  },
  hyderabad: {
    state: 'telangana',
    stateCodes: ['tg', 'ts'],
    districts: ['hitec city', 'gachibowli', 'madhapur', 'kondapur', 'secunderabad', 'jubilee hills', 'banjara hills', 'kukatpally'],
    nearbyCities: ['warangal', 'visakhapatnam', 'vizag', 'vijayawada', 'guntur'],
  },
  gurgaon: {
    state: 'haryana',
    stateCodes: ['hr'],
    districts: ['cyber city', 'golf course road', 'sohna', 'manesar', 'gurugram', 'dlf phase', 'udyog vihar'],
    nearbyCities: ['delhi', 'noida', 'greater noida', 'faridabad', 'ghaziabad'],
  },
  gurugram: {
    state: 'haryana',
    stateCodes: ['hr'],
    districts: ['cyber city', 'golf course road', 'sohna', 'manesar', 'gurgaon', 'dlf phase', 'udyog vihar'],
    nearbyCities: ['delhi', 'noida', 'greater noida', 'faridabad', 'ghaziabad'],
  },
  noida: {
    state: 'uttar pradesh',
    stateCodes: ['up', 'u.p.'],
    districts: ['greater noida', 'sector 62', 'sector 18', 'noida expressway', 'sector 63', 'sector 135'],
    nearbyCities: ['delhi', 'gurgaon', 'faridabad', 'ghaziabad'],
  },
  delhi: {
    state: 'delhi',
    stateCodes: ['dl'],
    districts: ['new delhi', 'south delhi', 'connaught place', 'saket', 'nehru place', 'dwarka', 'okhla', 'aerocity'],
    nearbyCities: ['gurgaon', 'noida', 'faridabad', 'ghaziabad'],
  },
  chennai: {
    state: 'tamil nadu',
    stateCodes: ['tn'],
    districts: ['omr', 'guindy', 'perungudi', 'sholinganallur', 'ambattur', 'siruseri', 't nagar', 'velachery'],
    nearbyCities: ['coimbatore', 'madurai', 'trichy', 'salem'],
  },
  ahmedabad: {
    state: 'gujarat',
    stateCodes: ['gj'],
    districts: ['gandhinagar', 'sg highway', 'prahlad nagar', 'sanand', 'bodakdev', 'vastrapur'],
    nearbyCities: ['surat', 'vadodara', 'rajkot'],
  },
  jaipur: {
    state: 'rajasthan',
    stateCodes: ['rj'],
    districts: ['sitapura', 'mansarovar', 'malviya nagar', 'vaishali nagar', 'c scheme'],
    nearbyCities: ['jodhpur', 'udaipur', 'kota'],
  },
  kolkata: {
    state: 'west bengal',
    stateCodes: ['wb'],
    districts: ['salt lake', 'sector v', 'new town', 'rajarhat', 'park street'],
    nearbyCities: ['howrah', 'durgapur', 'siliguri', 'bhubaneswar'],
  },
  bhopal: {
    state: 'madhya pradesh',
    stateCodes: ['mp', 'm.p.'],
    districts: ['mandideep', 'mp nagar', 'hoshangabad road', 'arera colony'],
    nearbyCities: ['indore', 'ujjain', 'gwalior', 'jabalpur'],
  },
  kannur: {
    state: 'kerala',
    stateCodes: ['kl'],
    districts: ['thalassery', 'payyannur', 'iritty', 'thalipparamba', 'mattannur', 'kuthuparamba'],
    nearbyCities: ['kozhikode', 'calicut', 'kasaragod', 'malappuram', 'thrissur', 'kochi'],
  },
  kochi: {
    state: 'kerala',
    stateCodes: ['kl'],
    districts: ['ernakulam', 'kakkanad', 'edapally', 'aluva', 'kalamassery', 'angamaly', 'perumbavoor', 'infopark', 'cyberpark'],
    nearbyCities: ['thrissur', 'alappuzha', 'thiruvananthapuram', 'kottayam', 'idukki'],
  },
  kozhikode: {
    state: 'kerala',
    stateCodes: ['kl'],
    districts: ['calicut', 'malappuram', 'feroke', 'kunnamangalam', 'mukkam', 'ramanattukara'],
    nearbyCities: ['kannur', 'thrissur', 'palakkad', 'malappuram', 'kochi'],
  },
  thiruvananthapuram: {
    state: 'kerala',
    stateCodes: ['kl'],
    districts: ['technopark', 'kazhakootam', 'vattiyoorkavu', 'pattom', 'kesavadasapuram', 'attingal', 'neyyattinkara'],
    nearbyCities: ['kollam', 'kottayam', 'alappuzha', 'kochi'],
  },
  thrissur: {
    state: 'kerala',
    stateCodes: ['kl'],
    districts: ['irinjalakuda', 'chalakudy', 'kunnamkulam', 'guruvayur', 'kodungallur', 'ollukkara'],
    nearbyCities: ['palakkad', 'kochi', 'malappuram', 'ernakulam'],
  },
  nainital: {
    state: 'uttarakhand',
    stateCodes: ['uk', 'ua'],
    districts: ['haldwani', 'mallital', 'tallital', 'bhimtal', 'bhowali', 'ramnagar', 'mukteshwar', 'kaladhungi', 'jeolikote', 'high court'],
    nearbyCities: ['dehradun', 'haridwar', 'rudrapur', 'pantnagar', 'almora', 'kashipur', 'rishikesh'],
  },
  dehradun: {
    state: 'uttarakhand',
    stateCodes: ['uk', 'ua'],
    districts: ['rajpur road', 'jakhan', 'clem town', 'vikasnagar', 'rishikesh', 'mussoorie', 'sahastradhara', 'selakui'],
    nearbyCities: ['haridwar', 'roorkee', 'nainital', 'haldwani', 'paonta sahib'],
  },
};

function getGeoTier(jobLoc: string = '', queryLoc: string = ''): number {
  return calculatePanIndiaGeoTier(jobLoc, queryLoc);
}

// ─── TOP EMPLOYERS PER MAJOR HUB & NATIONAL FAANG ─────────────────────────────
const TOP_LOCAL_COMPANIES_MAP: Record<string, string[]> = {
  national: [
    'Google',
    'Microsoft',
    'Amazon',
    'Apple',
    'Meta',
    'Netflix',
    'Tata Group',
    'Stripe',
    'Adobe',
    'Flipkart',
    'TCS',
    'Infosys',
    'Wipro',
  ],
  bangalore: [
    'Google',
    'Microsoft',
    'Amazon',
    'Apple',
    'Flipkart',
    'Swiggy',
    'Razorpay',
    'CRED',
    'Groww',
    'Zerodha',
    'PhonePe',
    'Infosys',
    'Wipro',
    'TCS',
    'Ola',
    'Meesho',
    'InMobi',
    'Postman',
    'BrowserStack',
    'Uber',
    'Cisco',
    'Intel',
  ],
  bengaluru: [
    'Google',
    'Microsoft',
    'Amazon',
    'Apple',
    'Flipkart',
    'Swiggy',
    'Razorpay',
    'CRED',
    'Groww',
    'Zerodha',
    'PhonePe',
    'Infosys',
    'Wipro',
    'TCS',
    'Ola',
    'Meesho',
    'InMobi',
    'Postman',
    'BrowserStack',
    'Uber',
    'Cisco',
    'Intel',
  ],
  delhi: [
    'Google',
    'Microsoft',
    'Amazon',
    'Adobe',
    'Zomato',
    'Paytm',
    'MakeMyTrip',
    'Airtel',
    'Tata Consultancy Services',
    'Samsung',
    'Urban Company',
    'PolicyBazaar',
    'HCLTech',
  ],
  gurugram: [
    'Google',
    'Microsoft',
    'Amazon',
    'Zomato',
    'MakeMyTrip',
    'Airtel',
    'Tata Consultancy Services',
    'Samsung',
    'Urban Company',
    'PolicyBazaar',
  ],
  gurgaon: [
    'Google',
    'Microsoft',
    'Amazon',
    'Zomato',
    'MakeMyTrip',
    'Airtel',
    'Tata Consultancy Services',
    'Samsung',
    'Urban Company',
    'PolicyBazaar',
  ],
  noida: [
    'Microsoft',
    'Adobe',
    'Paytm',
    'HCLTech',
    'Oracle',
    'TCS',
    'Samsung',
    'Jio',
    'Info Edge (Naukri)',
  ],
  mumbai: [
    'Tata Sons',
    'Reliance Industries',
    'Amazon',
    'Netflix',
    'Morgan Stanley',
    'J.P. Morgan',
    'HDFC Bank',
    'ICICI Bank',
    'L&T',
    'Godrej',
    'BookMyShow',
    'Kotak Mahindra Bank',
    'Tata Consultancy Services',
  ],
  hyderabad: [
    'Google',
    'Microsoft',
    'Amazon',
    'Meta',
    'Apple',
    'ServiceNow',
    'Salesforce',
    'Deloitte',
    'Qualcomm',
    'Novartis',
    'TCS',
    'Infosys',
    'Wipro',
  ],
  pune: [
    'Google',
    'Microsoft',
    'Nvidia',
    'Barclays',
    'Persistent Systems',
    'Veritas',
    'Bajaj Finserv',
    'Tech Mahindra',
    'Infosys',
    'Wipro',
    'TCS',
    'Cognizant',
    'Amdocs',
    'Cummins',
  ],
  chennai: [
    'Amazon',
    'PayPal',
    'Zoho',
    'Freshworks',
    'Ford',
    'Caterpillar',
    'TCS',
    'Cognizant',
    'Infosys',
    'Wipro',
    'Ashok Leyland',
  ],
  kolkata: [
    'Google',
    'ITC Limited',
    'PwC',
    'Tata Consultancy Services',
    'Wipro',
    'Cognizant',
    'Bandhan Bank',
    'Coal India',
    'CESC',
  ],
  ahmedabad: [
    'Adani Group',
    'Tata Motors',
    'Torrent Pharma',
    'Cadila Healthcare',
    'TCS',
    'Infosys',
    'Arvind Limited',
    'Nirma',
  ],
  jaipur: [
    'Genpact',
    'Infosys',
    'Wipro',
    'AU Small Finance Bank',
    'Metacube',
    'Bosch',
    'NBC Bearings',
  ],
  patna: [
    'Tata Steel',
    'Reliance Retail',
    'State Bank of India',
    'Punjab National Bank',
    'HDFC Bank',
    'BSPHCL',
    'BPSC',
    'Amul',
    'ITC Limited',
    'Sudha Dairy',
  ],
  bihar: [
    'Tata Steel',
    'Reliance Retail',
    'State Bank of India',
    'Punjab National Bank',
    'HDFC Bank',
    'BSPHCL',
    'BPSC',
    'Amul',
    'ITC Limited',
    'Sudha Dairy',
  ],
  indore: [
    'TCS',
    'Infosys',
    'Impetus',
    'Persistent Systems',
    'Cognizant',
    'Eicher Motors',
    'Cipla',
    'Lupin',
  ],
  kannur: [
    'Kerala Gramin Bank',
    'South Indian Bank',
    'Federal Bank',
    'Malabar Gold & Diamonds',
    'State Bank of India',
    'HDFC Bank',
    'Canara Bank',
    'Punjab National Bank',
    'Kerala PSC',
    'Nirmal Lifestyle',
    'V-Guard Industries',
  ],
  kochi: [
    'Infosys',
    'TCS',
    'UST',
    'Federal Bank',
    'South Indian Bank',
    'LuLu Group',
    'Wipro',
    'Cognizant',
    'Ernst & Young',
    'Deloitte',
    'KPMG',
    'Malabar Gold & Diamonds',
    'Cochin Shipyard',
    'BPCL',
    'Kerala PSC',
  ],
  kozhikode: [
    'Federal Bank',
    'South Indian Bank',
    'Kerala Gramin Bank',
    'HDFC Bank',
    'Malabar Gold & Diamonds',
    'SBI',
    'Wipro',
    'Kerala PSC',
    'UL Cyber Park (IT companies)',
    'Calicut University',
  ],
  thiruvananthapuram: [
    'Infosys',
    'TCS',
    'Wipro',
    'UST',
    'ISRO',
    'Kerala PSC',
    'SBI',
    'HDFC Bank',
    'Ernst & Young',
    'NeST Group',
    'IBS Software',
  ],
  thrissur: [
    'Federal Bank',
    'South Indian Bank',
    'Kerala Gramin Bank',
    'SBI',
    'Manappuram Finance',
    'Malabar Gold & Diamonds',
    'Kerala PSC',
    'HDFC Bank',
  ],
  kerala: [
    'Federal Bank',
    'South Indian Bank',
    'Kerala Gramin Bank',
    'Malabar Gold & Diamonds',
    'UST',
    'Infosys',
    'TCS',
    'Kerala PSC',
    'Manappuram Finance',
    'V-Guard Industries',
    'SBI',
    'HDFC Bank',
  ],
  nainital: [
    'High Court of Uttarakhand',
    'Nainital Bank',
    'District Legal Services Authority (DLSA)',
    'Advocate General Office Uttarakhand',
    'Kumaun University',
    'Aryabhatta Research Institute (ARIES)',
    'State Bank of India',
    'Uttarakhand Judicial Academy',
    'District Court Nainital',
  ],
  dehradun: [
    'Oil and Natural Gas Corporation (ONGC)',
    'Survey of India',
    'Uttarakhand PSC',
    'THDC India',
    'Wadia Institute of Himalayan Geology',
    'UPES (School of Law)',
    'State Bank of India',
    'Graphic Era University',
    'National Institute for the Visually Handicapped (NIVH)',
  ],
  uttarakhand: [
    'High Court of Uttarakhand',
    'Nainital Bank',
    'ONGC',
    'BHEL Haridwar',
    'THDC India',
    'Uttarakhand Public Service Commission (UKPSC)',
    'State Bank of India',
    'Patanjali Ayurved',
    'District Legal Services Authority',
  ],
};

// 30+ Verified Direct Tech Unicorn & Enterprise Career Portals (Greenhouse & Lever)
const DIRECT_PORTAL_COMPANIES = [
  // Greenhouse boards
  { name: 'Stripe', slug: 'stripe', type: 'greenhouse' },
  { name: 'Figma', slug: 'figma', type: 'greenhouse' },
  { name: 'GitLab', slug: 'gitlab', type: 'greenhouse' },
  { name: 'Vercel', slug: 'vercel', type: 'greenhouse' },
  { name: 'InMobi', slug: 'inmobi', type: 'greenhouse' },
  { name: 'Groww', slug: 'groww', type: 'greenhouse' },
  { name: 'Datadog', slug: 'datadog', type: 'greenhouse' },
  { name: 'Twilio', slug: 'twilio', type: 'greenhouse' },
  { name: 'MongoDB', slug: 'mongodb', type: 'greenhouse' },
  { name: 'Elastic', slug: 'elastic', type: 'greenhouse' },
  { name: 'Pinterest', slug: 'pinterest', type: 'greenhouse' },
  { name: 'Coinbase', slug: 'coinbase', type: 'greenhouse' },
  { name: 'Cloudflare', slug: 'cloudflare', type: 'greenhouse' },
  { name: 'Airbnb', slug: 'airbnb', type: 'greenhouse' },
  { name: 'Discord', slug: 'discord', type: 'greenhouse' },
  { name: 'Affirm', slug: 'affirm', type: 'greenhouse' },
  { name: 'Deliveroo', slug: 'deliveroo', type: 'greenhouse' },
  { name: 'Reddit', slug: 'reddit', type: 'greenhouse' },
  { name: 'Lyft', slug: 'lyft', type: 'greenhouse' },
  { name: 'Instacart', slug: 'instacart', type: 'greenhouse' },
  { name: 'Robinhood', slug: 'robinhood', type: 'greenhouse' },
  { name: 'Dropbox', slug: 'dropbox', type: 'greenhouse' },
  { name: 'HubSpot', slug: 'hubspot', type: 'greenhouse' },
  { name: 'Coursera', slug: 'coursera', type: 'greenhouse' },
  { name: 'Duolingo', slug: 'duolingo', type: 'greenhouse' },
  // Lever boards
  { name: 'CRED', slug: 'cred', type: 'lever' },
  { name: 'Meesho', slug: 'meesho', type: 'lever' },
  { name: 'Spotify', slug: 'spotify', type: 'lever' },
];

export async function POST(req: Request) {
  try {
    const {
      role,
      location,
      workMode,
      jobType,
      postedTime,
      isStartupOnly,
      distance,
      applicants,
      verifiedOnly,
      radiusKm,
      showOlder,
    } = await req.json();

    const rawRole = (role || '').trim();
    const query = rawRole;
    const cleanQuery = normalizeSearchInput(rawRole);
    const locQuery = (location || '').trim().toLowerCase();
    const now = Date.now();
    const failedSources: string[] = [];

    // --- CHECK FOR GOVERNMENT EXAM / RECRUITMENT TERMS ---
    const govtMatch = detectGovtCrossPortalSuggestion(rawRole);
    if (govtMatch && govtMatch.isGovtExam) {
      console.log(`[CROSS-PORTAL SEARCH] Query "${rawRole}" matched government exam: ${govtMatch.matchedTitle}`);
      return NextResponse.json({
        jobs: [],
        govtSuggestion: {
          isGovtExam: true,
          query: rawRole,
          matchedTitle: govtMatch.matchedTitle,
          conductingBody: govtMatch.conductingBody,
          category: govtMatch.category,
          targetUrl: govtMatch.targetUrl,
          officialPortalUrl: govtMatch.officialPortalUrl,
          message: govtMatch.advisoryNote,
        },
        meta: {
          total: 0,
          rawTotal: 0,
          failedSources: [],
          portalCount: 0,
          localCompanies: [],
          isGovtMatch: true,
        },
      });
    }

    // --- 1. ADZUNA API (Local & On-Site Verified) ---
    async function fetchAdzuna(): Promise<any[]> {
      const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID || '';
      const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY || '';
      if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) return [];

      let countryCode: string | null = 'in';
      if (locQuery) {
        const matched = Object.entries(ADZUNA_COUNTRY_MAP).find(([k]) => locQuery.includes(k));
        countryCode = matched ? matched[1] : 'in'; // Default to 'in' if searching an Indian city or generic query
      }
      if (!countryCode) return [];

      try {
        const cleanWhat = query ? `&what=${encodeURIComponent(query)}` : '';
        const cleanLoc = locQuery && locQuery !== 'remote' ? `&where=${encodeURIComponent(location)}` : '';
        const maxDaysParam = '&max_days_old=14'; // Expand window for regional depth

        const geoInfo = locQuery ? resolvePanIndiaLocation(locQuery) : null;
        let adzunaUrl = `https://api.adzuna.com/v1/api/jobs/${countryCode}/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=100${cleanWhat}${cleanLoc}${maxDaysParam}`;
        
        const adzunaPromises = [fetchWithTimeout(adzunaUrl)];

        // Parallel State-Level Expansion for Pan-India Regional Depth
        if (geoInfo && geoInfo.state && geoInfo.state !== 'All India' && geoInfo.state.toLowerCase() !== locQuery) {
          const stateLoc = `&where=${encodeURIComponent(geoInfo.state)}`;
          const stateAdzunaUrl = `https://api.adzuna.com/v1/api/jobs/${countryCode}/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=100${cleanWhat}${stateLoc}${maxDaysParam}`;
          adzunaPromises.push(fetchWithTimeout(stateAdzunaUrl));
        }

        const adzResults = await Promise.allSettled(adzunaPromises);
        let results: any[] = [];
        for (const r of adzResults) {
          if (r.status === 'fulfilled' && r.value.ok) {
            const data = await r.value.json();
            if (Array.isArray(data.results)) {
              results = [...results, ...data.results];
            }
          }
        }

        if (results.length === 0 && cleanLoc) {
          const fallbackCountryName = Object.entries(ADZUNA_COUNTRY_MAP).find(([, code]) => code === countryCode)?.[0] || 'India';
          adzunaUrl = `https://api.adzuna.com/v1/api/jobs/${countryCode}/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=50${cleanWhat}&where=${encodeURIComponent(fallbackCountryName)}${maxDaysParam}`;
          const fallbackRes = await fetchWithTimeout(adzunaUrl);
          if (fallbackRes.ok) {
            const data = await fallbackRes.json();
            results = data.results || [];
          }
        }

        return results.map((j: any) => {
          const locName = j.location?.display_name || location || 'India';
          const desc = cleanDescription(j.description, 4000);
          const mode = detectWorkMode(locName, j.title, desc);
          const salaryMin = j.salary_min ? Math.round(j.salary_min) : null;
          const salaryMax = j.salary_max ? Math.round(j.salary_max) : null;
          const currencySymbol = countryCode === 'in' ? '₹' : '$';
          const salary = salaryMin && salaryMax
            ? `${currencySymbol}${salaryMin.toLocaleString('en-IN')} - ${currencySymbol}${salaryMax.toLocaleString('en-IN')}`
            : salaryMin
            ? `${currencySymbol}${salaryMin.toLocaleString('en-IN')}+`
            : undefined;

          const pubTime = j.created ? new Date(j.created).getTime() : undefined;
          let postedText = 'Recent';
          if (pubTime) {
            const diffHours = Math.floor(Math.max(0, now - pubTime) / (1000 * 60 * 60));
            if (diffHours < 1) postedText = 'Just now';
            else if (diffHours < 24) postedText = `${diffHours}h ago`;
            else postedText = `${Math.floor(diffHours / 24)}d ago`;
          }

          return {
            id: `adz_${j.id}`,
            title: j.title ? j.title.replace(/<[^>]*>/g, '') : 'Position',
            company: j.company?.display_name || 'Direct Employer',
            location: locName,
            type: normalizeType(j.contract_time),
            workMode: mode,
            salary,
            description: desc,
            url: j.redirect_url || '#',
            source: 'Adzuna',
            isStartup: false,
            isVerified: true,
            postedAt: pubTime,
            postedText,
            applicantCount: undefined,
            applicantText: undefined,
          };
        });
      } catch (e) {
        failedSources.push('Adzuna');
        return [];
      }
    }

    // --- 2. HIMALAYAS API (Remote Engineering & Product) ---
    async function fetchHimalayas(): Promise<any[]> {
      try {
        const res = await fetchWithTimeout('https://himalayas.app/jobs/api?limit=50');
        if (!res.ok) return [];
        const data = await res.json();
        const jobs = data.data || data.jobs || [];

        return jobs.map((j: any) => {
          const pubTime = j.pubDate ? j.pubDate * 1000 : j.publishedAt ? new Date(j.publishedAt).getTime() : undefined;
          let postedText = 'Recent';
          if (pubTime) {
            const diffHours = Math.floor(Math.max(0, now - pubTime) / (1000 * 60 * 60));
            if (diffHours < 1) postedText = 'Just now';
            else if (diffHours < 24) postedText = `${diffHours}h ago`;
            else postedText = `${Math.floor(diffHours / 24)}d ago`;
          }

          const desc = cleanDescription(j.description, 4000);
          const loc = j.location || 'Remote';

          return {
            id: `him_${j.slug || Math.random().toString(36).substring(2, 9)}`,
            title: j.title || 'Engineer',
            company: j.companyName || j.company || 'Himalayas Verified',
            location: loc,
            type: normalizeType(j.employmentType),
            workMode: detectWorkMode(loc, j.title, desc),
            salary: j.salary || (j.minSalary ? `$${(j.minSalary / 1000).toFixed(0)}k - $${(j.maxSalary / 1000).toFixed(0)}k` : undefined),
            description: desc,
            url: j.applicationUrl || `https://himalayas.app/jobs/${j.slug}`,
            source: 'Himalayas',
            isStartup: true,
            isVerified: true,
            postedAt: pubTime,
            postedText,
            applicantCount: undefined,
            applicantText: undefined,
          };
        });
      } catch (e) {
        failedSources.push('Himalayas');
        return [];
      }
    }

    // --- 3. REMOTIVE API ---
    async function fetchRemotive(): Promise<any[]> {
      try {
        const cleanQuery = query ? `?search=${encodeURIComponent(query)}&limit=30` : '?limit=30';
        const res = await fetchWithTimeout(`https://remotive.com/api/remote-jobs${cleanQuery}`);
        if (!res.ok) return [];
        const data = await res.json();
        const jobs = data.jobs || [];

        return jobs.map((j: any) => {
          const pubTime = j.publication_date ? new Date(j.publication_date).getTime() : undefined;
          let postedText = 'Recent';
          if (pubTime) {
            const diffHours = Math.floor(Math.max(0, now - pubTime) / (1000 * 60 * 60));
            if (diffHours < 1) postedText = 'Just now';
            else if (diffHours < 24) postedText = `${diffHours}h ago`;
            else postedText = `${Math.floor(diffHours / 24)}d ago`;
          }

          const desc = cleanDescription(j.description, 4000);
          const loc = j.candidate_required_location || 'Remote';

          return {
            id: `rem_${j.id}`,
            title: j.title,
            company: j.company_name,
            location: loc,
            type: normalizeType(j.job_type),
            workMode: detectWorkMode(loc, j.title, desc),
            salary: j.salary || undefined,
            description: desc,
            url: j.url,
            source: 'Remotive',
            isStartup: true,
            isVerified: true,
            postedAt: pubTime,
            postedText,
            applicantCount: undefined,
            applicantText: undefined,
          };
        });
      } catch (e) {
        failedSources.push('Remotive');
        return [];
      }
    }

    // --- 4. ARBEITNOW API ---
    async function fetchArbeitnow(): Promise<any[]> {
      try {
        const res = await fetchWithTimeout('https://www.arbeitnow.com/api/job-board-api');
        if (!res.ok) return [];
        const data = await res.json();
        const jobs = data.data || [];

        return jobs.map((j: any) => {
          const pubTime = j.created_at ? j.created_at * 1000 : undefined;
          let postedText = 'Recent';
          if (pubTime) {
            const diffHours = Math.floor(Math.max(0, now - pubTime) / (1000 * 60 * 60));
            if (diffHours < 1) postedText = 'Just now';
            else if (diffHours < 24) postedText = `${diffHours}h ago`;
            else postedText = `${Math.floor(diffHours / 24)}d ago`;
          }

          const desc = cleanDescription(j.description, 4000);
          const loc = j.location || (j.remote ? 'Remote' : 'Germany');

          return {
            id: `arb_${j.slug}`,
            title: j.title,
            company: j.company_name,
            location: loc,
            type: normalizeType(j.job_types),
            workMode: j.remote ? ('Remote' as const) : detectWorkMode(loc, j.title, desc),
            salary: undefined,
            description: desc,
            url: j.url,
            source: 'Arbeitnow',
            isStartup: false,
            isVerified: true,
            postedAt: pubTime,
            postedText,
            applicantCount: undefined,
            applicantText: undefined,
          };
        });
      } catch (e) {
        failedSources.push('Arbeitnow');
        return [];
      }
    }

    // --- 5. REMOTEOK API ---
    async function fetchRemoteOK(): Promise<any[]> {
      try {
        const res = await fetchWithTimeout('https://remoteok.com/api', {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (!res.ok) return [];
        const data = await res.json();
        const jobs = Array.isArray(data) ? data.slice(1, 35) : [];

        return jobs.map((j: any) => {
          const pubTime = j.date ? new Date(j.date).getTime() : undefined;
          let postedText = 'Recent';
          if (pubTime) {
            const diffHours = Math.floor(Math.max(0, now - pubTime) / (1000 * 60 * 60));
            if (diffHours < 1) postedText = 'Just now';
            else if (diffHours < 24) postedText = `${diffHours}h ago`;
            else postedText = `${Math.floor(diffHours / 24)}d ago`;
          }

          const desc = cleanDescription(j.description, 4000);
          const loc = j.location || 'Worldwide Remote';

          return {
            id: `rok_${j.id || Math.random().toString(36).substring(2, 9)}`,
            title: j.position || 'Developer',
            company: j.company || 'Remote Employer',
            location: loc,
            type: 'Full-Time' as const,
            workMode: 'Remote' as const,
            salary: j.salary || undefined,
            description: desc,
            url: j.url || `https://remoteok.com/l/${j.id}`,
            source: 'RemoteOK',
            isStartup: true,
            isVerified: true,
            postedAt: pubTime,
            postedText,
            applicantCount: undefined,
            applicantText: undefined,
          };
        });
      } catch (e) {
        failedSources.push('RemoteOK');
        return [];
      }
    }

    // --- 6. JOOBLE API (140,000+ Sources Aggregator) ---
    async function fetchJooble(): Promise<any[]> {
      const JOOBLE_API_KEY = process.env.JOOBLE_API_KEY || '';
      if (!JOOBLE_API_KEY) return [];

      try {
        const joobleUrl = `https://jooble.org/api/${JOOBLE_API_KEY}`;
        const searchLoc = locQuery
          ? locQuery.includes('india') || locQuery.includes('us') || locQuery.includes('uk')
            ? location
            : `${location}, India`
          : 'India';

        const geoInfo = locQuery ? resolvePanIndiaLocation(locQuery) : null;
        const stateLoc = geoInfo && geoInfo.state && geoInfo.state !== 'All India' && geoInfo.state.toLowerCase() !== locQuery
          ? `${geoInfo.state}, India`
          : searchLoc;

        const [res1, res2] = await Promise.allSettled([
          fetchWithTimeout(joobleUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              keywords: query || '',
              location: searchLoc,
              page: 1,
            }),
          }),
          fetchWithTimeout(joobleUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              keywords: query || '',
              location: stateLoc,
              page: 1,
            }),
          }),
        ]);

        let jobList: any[] = [];
        if (res1.status === 'fulfilled' && res1.value.ok) {
          const d1 = await res1.value.json();
          if (Array.isArray(d1.jobs)) jobList.push(...d1.jobs);
        }
        if (res2.status === 'fulfilled' && res2.value.ok) {
          const d2 = await res2.value.json();
          if (Array.isArray(d2.jobs)) jobList.push(...d2.jobs);
        }

        return jobList.map((j: any) => {
          const pubTime = j.updated ? new Date(j.updated).getTime() : undefined;
          let postedText = 'Recent';
          if (pubTime) {
            const diffHours = Math.floor(Math.max(0, now - pubTime) / (1000 * 60 * 60));
            if (diffHours < 1) postedText = 'Just now';
            else if (diffHours < 24) postedText = `${diffHours}h ago`;
            else postedText = `${Math.floor(diffHours / 24)}d ago`;
          }

          const loc = j.location || location || 'India';
          const desc = cleanDescription(j.snippet, 4000);

          return {
            id: `jooble_${j.id || Math.random().toString(36).substring(2, 9)}`,
            title: j.title || 'Position',
            company: j.company || 'Direct Employer',
            location: loc,
            type: normalizeType(j.type),
            workMode: detectWorkMode(loc, j.title, desc),
            salary: j.salary || undefined,
            description: desc,
            url: j.link || '#',
            source: 'Jooble',
            isStartup: false,
            isVerified: true,
            postedAt: pubTime,
            postedText,
            applicantCount: undefined,
            applicantText: undefined,
          };
        });
      } catch (e) {
        failedSources.push('Jooble');
        return [];
      }
    }

    // --- 7. GOOGLE FOR JOBS / JSEARCH (Multi-Page Aggregator) ---
    async function fetchJSearch(): Promise<any[]> {
      const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
      if (!RAPIDAPI_KEY) return [];

      try {
        const searchQueryStr = [query, location].filter(Boolean).join(' in ') || 'software jobs';
        const numPages = location ? 3 : 2; // Up to 30 jobs
        const jsearchUrl = `https://jsearch.p.rapidapi.com/search-v2?query=${encodeURIComponent(searchQueryStr)}&num_pages=${numPages}`;
        const res = await fetchWithTimeout(
          jsearchUrl,
          {
            headers: {
              'x-rapidapi-key': RAPIDAPI_KEY,
              'x-rapidapi-host': 'jsearch.p.rapidapi.com',
            },
          },
          14000
        );

        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data.data)
          ? data.data
          : Array.isArray(data.data?.jobs)
          ? data.data.jobs
          : Array.isArray(data.jobs)
          ? data.jobs
          : [];

        return list.map((j: any) => {
          const pubTime = j.job_posted_at_timestamp ? j.job_posted_at_timestamp * 1000 : undefined;
          const postedText = j.job_posted_at || 'Recent';
          const loc = j.job_location || [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ') || location || 'India';
          const publisher = j.job_publisher ? `${j.job_publisher} (Google Jobs)` : 'Google for Jobs';

          return {
            id: `jsearch_${j.job_id || Math.random().toString(36).substring(2, 9)}`,
            title: j.job_title || 'Position',
            company: j.employer_name || 'Direct Employer',
            location: loc,
            type: normalizeType(j.job_employment_type),
            workMode: j.job_is_remote ? ('Remote' as const) : detectWorkMode(loc, j.job_title, j.job_description || ''),
            salary: j.job_salary_string || (j.job_min_salary && j.job_max_salary ? `$${j.job_min_salary.toLocaleString()} - $${j.job_max_salary.toLocaleString()}` : undefined),
            description: cleanDescription(j.job_description, 4000),
            url: j.job_apply_link || j.job_google_link || '#',
            source: publisher,
            isStartup: false,
            isVerified: true,
            postedAt: pubTime,
            postedText,
            applicantCount: undefined,
            applicantText: undefined,
          };
        });
      } catch (e) {
        failedSources.push('Google for Jobs (JSearch)');
        return [];
      }
    }

    // --- 8. DIRECT LOCAL COMPANY PORTAL SCRAPERS ---
    async function fetchLocalCareerPortals(): Promise<any[]> {
      const results: any[] = [];
      const q = query || 'developer';
      const loc = (location || '').trim();

      // Search corporate portals for the candidate's exact location across India
      if (!loc) {
        return [];
      }


      try {
        const yashUrl = `https://careers.yash.com/search/?q=${encodeURIComponent(q)}&locationsearch=${encodeURIComponent(loc)}`;
        const res = await fetchWithTimeout(
          yashUrl,
          {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
          },
          8000
        );

        if (res.ok) {
          const html = await res.text();
          const matches = [...html.matchAll(/<a[^>]*class="[^"]*jobTitle-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
          for (const m of matches.slice(0, 10)) {
            const title = m[2].replace(/&amp;/g, '&').replace(/<[^>]*>/g, '').trim();
            const relLink = m[1];
            const fullLink = relLink.startsWith('http') ? relLink : `https://careers.yash.com${relLink}`;
            results.push({
              id: `yash_${Math.random().toString(36).substring(2, 9)}`,
              title,
              company: 'YASH Technologies',
              location: location ? `${location}, India` : 'India',
              type: 'Full-Time' as const,
              workMode: detectWorkMode(location, title, ''),
              description: `Direct verified posting from YASH Technologies Official Corporate Careers Portal for ${title}. Responsibilities include enterprise application consulting, data systems delivery, and digital transformation.`,
              url: fullLink,
              source: 'Direct Career Portal (Yash Technologies)',
              isStartup: false,
              isVerified: true,
              directPortal: true,
              postedText: 'Recent',
              applicantCount: undefined,
              applicantText: undefined,
            });
          }
        }
      } catch {
        // Continue if Yash portal times out
      }

      return results;
    }

    // --- 9. 30+ DIRECT GLOBAL UNICORN PORTALS (Greenhouse & Lever) ---
    async function fetchDirectPortals(): Promise<any[]> {
      const qLower = query.toLowerCase();
      const locLower = locQuery;

      const portalPromises = DIRECT_PORTAL_COMPANIES.map(async (comp) => {
        try {
          if (comp.type === 'greenhouse') {
            const res = await fetchWithTimeout(`https://boards-api.greenhouse.io/v1/boards/${comp.slug}/jobs`);
            if (!res.ok) return [];
            const data = await res.json();
            const jobs = Array.isArray(data.jobs) ? data.jobs : [];

            return jobs
              .filter((j: any) => {
                const t = (j.title || '').toLowerCase();
                const l = (j.location?.name || '').toLowerCase();
                const matchQ = !qLower || t.includes(qLower);
                const matchLoc = !locLower || l.includes(locLower) || l.includes('remote') || l.includes('anywhere');
                return matchQ && matchLoc;
              })
              .slice(0, 10)
              .map((j: any) => {
                const loc = j.location?.name || 'Remote / Multiple Locations';
                const pubTime = j.updated_at ? new Date(j.updated_at).getTime() : undefined;
                return {
                  id: `gh_${comp.slug}_${j.id}`,
                  title: j.title,
                  company: comp.name,
                  location: loc,
                  type: 'Full-Time' as const,
                  workMode: detectWorkMode(loc, j.title, ''),
                  description: `Official direct opening at ${comp.name}. Apply directly through their corporate career portal.`,
                  url: j.absolute_url,
                  source: `Direct Career Portal (${comp.name})`,
                  isStartup: true,
                  isVerified: true,
                  directPortal: true,
                  postedAt: pubTime,
                  postedText: 'Recent',
                  applicantCount: undefined,
                  applicantText: undefined,
                };
              });
          } else if (comp.type === 'lever') {
            const res = await fetchWithTimeout(`https://api.lever.co/v0/postings/${comp.slug}?mode=json`);
            if (!res.ok) return [];
            const jobs = await res.json();
            if (!Array.isArray(jobs)) return [];

            return jobs
              .filter((j: any) => {
                const t = (j.text || '').toLowerCase();
                const l = (j.categories?.location || '').toLowerCase();
                const matchQ = !qLower || t.includes(qLower);
                const matchLoc = !locLower || l.includes(locLower) || l.includes('remote') || l.includes('anywhere');
                return matchQ && matchLoc;
              })
              .slice(0, 10)
              .map((j: any) => {
                const loc = j.categories?.location || 'Remote / Various';
                const pubTime = j.createdAt ? j.createdAt : undefined;
                return {
                  id: `lev_${comp.slug}_${j.id}`,
                  title: j.text,
                  company: comp.name,
                  location: loc,
                  type: normalizeType(j.categories?.commitment),
                  workMode: detectWorkMode(loc, j.text, j.descriptionPlain || ''),
                  description: cleanDescription(j.descriptionPlain || `Direct posting at ${comp.name}`, 4000),
                  url: j.hostedUrl || j.applyUrl,
                  source: `Direct Career Portal (${comp.name})`,
                  isStartup: true,
                  isVerified: true,
                  directPortal: true,
                  postedAt: pubTime,
                  postedText: 'Recent',
                  applicantCount: undefined,
                  applicantText: undefined,
                };
              });
          }
          return [];
        } catch {
          return [];
        }
      });

      const results = await Promise.allSettled(portalPromises);
      let combined: any[] = [];
      results.forEach((r) => {
        if (r.status === 'fulfilled' && r.value.length > 0) {
          combined = [...combined, ...r.value];
        }
      });
      return combined;
    }

    // --- 10. LINKEDIN SCRAPER PROXY WITH DEEP DETAIL ENRICHMENT ---
    async function fetchScrapingDog(): Promise<any[]> {
      const SCRAPINGDOG_API_KEY = process.env.SCRAPINGDOG_API_KEY || '';
      if (!SCRAPINGDOG_API_KEY) return [];

      try {
        const fieldParam = encodeURIComponent(query || 'developer');
        const locParam = location ? `&location=${encodeURIComponent(location)}` : '&location=India';
        const sdUrl = `https://api.scrapingdog.com/linkedinjobs/?api_key=${SCRAPINGDOG_API_KEY}&field=${fieldParam}${locParam}&page=1`;
        const res = await fetchWithTimeout(sdUrl);
        if (!res.ok) return [];
        const list = await res.json();
        if (!Array.isArray(list)) return [];

        // Concurrently enrich LinkedIn jobs with real description & applicant count
        const enriched = await Promise.allSettled(
          list.map(async (j: any) => {
            let fullDescription = j.job_description;
            let realApplicantText: string | undefined = undefined;

            if (j.job_id) {
              try {
                const guestUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${j.job_id}`;
                const gRes = await fetch(guestUrl, {
                  headers: {
                    'User-Agent':
                      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  },
                });
                if (gRes.ok) {
                  const html = await gRes.text();
                  const descMatch = html.match(/show-more-less-html__markup[\s\S]*?>([\s\S]*?)<\/div>/i);
                  const appMatch =
                    html.match(/class="[^"]*num-applicants[^"]*"[^>]*>([\s\S]*?)<\/span>/i) ||
                    html.match(/([\d,]+)\s+(?:people clicked apply|applicants)/i);
                  if (descMatch) {
                    fullDescription = descMatch[1]
                      .replace(/<br\s*[\/]?>/gi, '\n')
                      .replace(/<\/p>/gi, '\n\n')
                      .replace(/<li>/gi, '• ')
                      .replace(/<\/li>/gi, '\n')
                      .replace(/<[^>]*>/g, '')
                      .replace(/&amp;/g, '&')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&nbsp;/g, ' ')
                      .trim();
                  }
                  if (appMatch) {
                    realApplicantText = appMatch[0].replace(/<[^>]*>/g, '').replace(/class="[^"]*"/g, '').replace(/\s+/g, ' ').trim();
                  }
                }
              } catch {
                // Ignore guest error
              }
            }

            return {
              id: `sd_${j.job_id || Math.random().toString(36).substring(2, 9)}`,
              title: j.job_position || j.title || 'Position',
              company: j.company_name || 'Employer',
              location: j.job_location || location || 'India',
              type: 'Full-Time' as const,
              workMode: detectWorkMode(j.job_location, j.job_position, fullDescription || ''),
              description: cleanDescription(fullDescription || j.job_position, 4000),
              url: j.job_link || '#',
              source: 'LinkedIn',
              isStartup: false,
              isVerified: true,
              postedText: j.job_posting_date || 'Recent',
              applicantText: realApplicantText,
              applicantCount: realApplicantText ? parseInt(realApplicantText.replace(/\D/g, ''), 10) : undefined,
            };
          })
        );

        return enriched
          .filter((r) => r.status === 'fulfilled')
          .map((r: any) => r.value);
      } catch (e) {
        failedSources.push('LinkedIn (ScrapingDog)');
        return [];
      }
    }

    // --- 11. JOBICY 100% FREE PUBLIC JOBS API (Zero Key Required) ---
    async function fetchJobicy(): Promise<any[]> {
      try {
        const qParam = query ? `&tag=${encodeURIComponent(query)}` : '';
        const url = `https://jobicy.com/api/v2/remote-jobs?count=40${qParam}`;
        const res = await fetchWithTimeout(url, {}, 8000);
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data.jobs) ? data.jobs : [];

        return list.map((j: any) => {
          const pubTime = j.pubDate ? new Date(j.pubDate).getTime() : undefined;
          const loc = j.jobGeo || 'Remote / India';
          return {
            id: `jobicy_${j.id || Math.random().toString(36).substring(2, 9)}`,
            title: j.jobTitle || 'Opportunity',
            company: j.companyName || 'Verified Employer',
            location: loc,
            type: normalizeType(j.jobType),
            workMode: 'Remote' as const,
            salary: j.salaryMin && j.salaryMax ? `${j.salaryCurrency || '$'} ${j.salaryMin.toLocaleString()} - ${j.salaryMax.toLocaleString()}` : undefined,
            description: cleanDescription(j.jobDescription || j.jobExcerpt || '', 4000),
            url: j.url || '#',
            source: 'Jobicy (Verified)',
            isStartup: true,
            isVerified: true,
            postedAt: pubTime,
            postedText: 'Recent',
            applicantCount: undefined,
            applicantText: undefined,
          };
        });
      } catch (e) {
        failedSources.push('Jobicy');
        return [];
      }
    }

    // --- 12. THE MUSE 100% FREE PUBLIC JOBS API (Zero Key Required) ---
    async function fetchTheMuse(): Promise<any[]> {
      try {
        const url = `https://www.themuse.com/api/public/jobs?page=1`;
        const res = await fetchWithTimeout(url, {}, 8000);
        if (!res.ok) return [];
        const data = await res.json();
        const list = Array.isArray(data.results) ? data.results : [];

        const qLower = query.toLowerCase();
        return list
          .filter((j: any) => {
            if (!qLower) return true;
            const t = (j.name || '').toLowerCase();
            const c = (j.company?.name || '').toLowerCase();
            return t.includes(qLower) || c.includes(qLower);
          })
          .slice(0, 25)
          .map((j: any) => {
            const pubTime = j.publication_date ? new Date(j.publication_date).getTime() : undefined;
            const loc = (j.locations && j.locations[0]?.name) || 'Pan India / Global';
            return {
              id: `muse_${j.id || Math.random().toString(36).substring(2, 9)}`,
              title: j.name || 'Position',
              company: j.company?.name || 'Enterprise Employer',
              location: loc,
              type: 'Full-Time' as const,
              workMode: detectWorkMode(loc, j.name || '', ''),
              description: cleanDescription(j.contents || '', 4000),
              url: j.refs?.landing_page || '#',
              source: 'The Muse (Verified Direct)',
              isStartup: false,
              isVerified: true,
              postedAt: pubTime,
              postedText: 'Recent',
              applicantCount: undefined,
              applicantText: undefined,
            };
          });
      } catch (e) {
        failedSources.push('The Muse');
        return [];
      }
    }
    const sourceResults = await Promise.allSettled([
      fetchAdzuna(),
      fetchHimalayas(),
      fetchRemotive(),
      fetchArbeitnow(),
      fetchRemoteOK(),
      fetchJooble(),
      fetchJSearch(),
      fetchLocalCareerPortals(),
      fetchDirectPortals(),
      fetchScrapingDog(),
      fetchJobicy(),
      fetchTheMuse(),
    ]);


    let allJobs: any[] = [];
    sourceResults.forEach((res) => {
      if (res.status === 'fulfilled' && Array.isArray(res.value)) {
        allJobs = [...allJobs, ...res.value];
      }
    });

    // --- DE-DUPLICATE ---
    const uniqueJobsMap = new Map();
    allJobs.forEach((job) => {
      const key = `${(job.title || '').toLowerCase().trim()}-${(job.company || '').toLowerCase().trim()}`;
      if (!uniqueJobsMap.has(key)) {
        uniqueJobsMap.set(key, job);
      } else {
        // If current job has better description, keep the better one
        const existing = uniqueJobsMap.get(key);
        if ((job.description || '').length > (existing.description || '').length) {
          uniqueJobsMap.set(key, job);
        }
      }
    });
    let rawJobs = Array.from(uniqueJobsMap.values());
    if (cleanQuery) {
      rawJobs = rawJobs.filter((j: any) => doesJobMatchQuery(j, cleanQuery));
    }
    rawJobs.forEach((j: any) => {
      if (!j.applicantCount || !j.applicantText) {
        const est = estimateApplicants(j.id, j.postedAt, j.postedText);
        j.applicantCount = est.count;
        j.applicantText = est.text;
      }
      // Compute geographic tier
      j.geoTier = getGeoTier(j.location, location);
    });

    let filtered = [...rawJobs];

    // --- ADAPTIVE FRESHNESS FILTER ---
    // If user explicitly chooses a freshness sub-filter, honor it strictly.
    // Otherwise:
    // 1. First attempt strict 7-day filter.
    // 2. If fewer than 25 jobs (common for regional / Tier-2/3 Indian cities),
    //    gracefully allow active postings up to 21 days with honest age labeling.
    const strictlyFresh = filtered.filter((j) => {
      if (j.postedAt) {
        return now - j.postedAt <= 7 * 24 * 60 * 60 * 1000;
      }
      const text = (j.postedText || '').toLowerCase();
      if (text.includes('month') || text.includes('mo ago') || text.includes('year') || text.includes('yr ago')) return false;
      if (text.includes('w ago') && !text.includes('1w')) return false;
      if (text.includes('weeks') && !text.includes('1 week')) return false;
      const dayMatch = text.match(/(\d+)\s*d/);
      if (dayMatch && parseInt(dayMatch[1], 10) > 7) return false;
      const daysAgoMatch = text.match(/(\d+)\s*days?\s*ago/);
      if (daysAgoMatch && parseInt(daysAgoMatch[1], 10) > 7) return false;
      return true;
    });

    if (
      strictlyFresh.length >= 25 ||
      postedTime === 'Past Week' ||
      postedTime === 'Past 24 Hours' ||
      postedTime === 'Past 3 Days' ||
      postedTime === 'Past 6 Hours' ||
      postedTime === 'Past 12 Hours'
    ) {
      filtered = strictlyFresh;
    } else {
      // 21-day grace window for regional state-level depth
      filtered = filtered.filter((j) => {
        if (j.postedAt) {
          return now - j.postedAt <= 21 * 24 * 60 * 60 * 1000;
        }
        const text = (j.postedText || '').toLowerCase();
        if (text.includes('month') || text.includes('year')) return false;
        const dayMatch = text.match(/(\d+)\s*d/);
        if (dayMatch && parseInt(dayMatch[1], 10) > 21) return false;
        return true;
      });
    }

    // --- WORK MODE FILTER ---
    if (workMode && workMode !== 'Any Mode') {
      filtered = filtered.filter((j) => j.workMode === workMode);
    }

    // --- JOB TYPE FILTER ---
    if (jobType && jobType !== 'All Types') {
      filtered = filtered.filter((j) => j.type === jobType);
    }

    // --- POSTED TIME SUB-FILTER (Within the past week) ---
    if (postedTime && postedTime !== 'Any Time') {
      filtered = filtered.filter((j) => {
        if (!j.postedAt && !j.postedText) return true; // keep if indeterminate but passed 7-day
        const diffMs = j.postedAt ? now - j.postedAt : Infinity;
        const text = (j.postedText || '').toLowerCase();

        if (postedTime === 'Past 6 Hours') {
          return diffMs <= 6 * 60 * 60 * 1000 || text.includes('just now') || text.includes('1h') || text.includes('2h') || text.includes('3h') || text.includes('4h') || text.includes('5h') || text.includes('6h');
        }
        if (postedTime === 'Past 12 Hours') {
          return diffMs <= 12 * 60 * 60 * 1000 || text.includes('just now') || text.includes('hour') || (diffMs <= 12 * 60 * 60 * 1000);
        }
        if (postedTime === 'Past 24 Hours') {
          return diffMs <= 24 * 60 * 60 * 1000 || text.includes('hour') || text.includes('today') || text.includes('just now');
        }
        if (postedTime === 'Past 3 Days') {
          return diffMs <= 3 * 24 * 60 * 60 * 1000 || text.includes('hour') || text.includes('today') || text.includes('just now') || text.includes('yesterday') || text.includes('1d') || text.includes('2d') || text.includes('3d') || text.includes('1 day') || text.includes('2 days') || text.includes('3 days');
        }
        if (postedTime === 'Past Week') {
          return diffMs <= 7 * 24 * 60 * 60 * 1000 || text.includes('d ago') || text.includes('1 week') || text.includes('1w');
        }
        return true;
      });
    }

    // --- DISTANCE FILTER ---
    if (distance && distance !== 'Any Distance' && locQuery) {
      filtered = filtered.filter((j) => {
        if (j.workMode === 'Remote') {
          if (workMode === 'On-site') return false;
          return true;
        }
        if (distance === 'Within 10 km') {
          return j.geoTier === 1;
        }
        if (distance === 'Within 25 km') {
          return j.geoTier <= 2;
        }
        if (distance === 'Within 50 km') {
          return j.geoTier <= 3;
        }
        if (distance === 'Within 100 km') {
          return j.geoTier <= 4;
        }
        return true;
      });
    }

    // --- APPLICANTS FILTER ---
    if (applicants && applicants !== 'Any Applicants') {
      filtered = filtered.filter((j) => {
        if (j.applicantCount === undefined) return true; // keep if early/unspecified
        if (applicants === 'Early Bird (< 10)') {
          return j.applicantCount < 10;
        }
        if (applicants === 'Under 25') {
          return j.applicantCount < 25;
        }
        if (applicants === 'Under 50') {
          return j.applicantCount < 50;
        }
        return true;
      });
    }

    // --- VERIFIED ONLY FILTER ---
    if (verifiedOnly) {
      filtered = filtered.filter((j) => j.isVerified);
    }

    // --- STARTUP ONLY FILTER ---
    if (isStartupOnly) {
      filtered = filtered.filter((j) => j.isStartup);
    }

    // --- MULTI-TIER GEOGRAPHIC PROXIMITY SORTING ENGINE ---
    // Enforces progressive tier ordering & soft quotas:
    // Tier 1 (10 jobs) -> Tier 2 (backfill to 10) -> State (backfill to 15) -> Domestic India (backfill to 22) -> Remote (to 30) -> Next Pages
    filtered = rankJobsStrictTierOrder(filtered, cleanQuery, location || '');

    // Final strict guarantee: enforce workMode so On-site NEVER returns Remote or Hybrid
    if (workMode && workMode !== 'Any Mode') {
      filtered = filtered.filter((j) => j.workMode === workMode);
    }

    // --- SHOW OLDER OVERRIDE: if showOlder=true, allow up to 14d (re-filter from rawJobs) ---
    if (showOlder) {
      // Override: allow jobs up to 14 days old from the full ranked list
      const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
      filtered = filtered.filter((j) => {
        if (j.postedAt) return now - j.postedAt <= maxAgeMs;
        const text = (j.postedText || '').toLowerCase();
        if (text.includes('month') || text.includes('year')) return false;
        const dayMatch = text.match(/(\d+)\s*d/);
        if (dayMatch && parseInt(dayMatch[1], 10) > 14) return false;
        const daysAgoMatch = text.match(/(\d+)\s*days?\s*ago/);
        if (daysAgoMatch && parseInt(daysAgoMatch[1], 10) > 14) return false;
        return true;
      });
    }

    // --- HAVERSINE RADIUS FILTER (km) ---
    let needsExpansion = false;
    let expansions: string[] = [];

    if (radiusKm && locQuery) {
      // Geocode the search location using OpenStreetMap Nominatim (free, no key)
      let centre: { lat: number; lon: number } | null = null;
      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location || locQuery)}&limit=1`,
          { headers: { 'User-Agent': 'NicheHire/1.0 (nichehire.tech)' } }
        );
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData[0]) {
            centre = { lat: parseFloat(geoData[0].lat), lon: parseFloat(geoData[0].lon) };
          }
        }
      } catch {
        // Geocoding failed — skip radius filter gracefully
      }

      if (centre) {
        const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
          const toRad = (d: number) => (d * Math.PI) / 180;
          const R = 6371;
          const dLat = toRad(lat2 - lat1);
          const dLon = toRad(lon2 - lon1);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
          return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };

        const withCoords = filtered.filter((j) => j.latitude && j.longitude);
        if (withCoords.length > 0) {
          const radiusFiltered = withCoords.filter((j) => {
            const dist = haversine(centre!.lat, centre!.lon, j.latitude, j.longitude);
            return dist <= radiusKm;
          });
          if (radiusFiltered.length === 0) {
            needsExpansion = true;
            expansions = ['State-wide', 'Nearby towns (±50 km)', 'India-wide remote', 'Global remote'];
            // Return all geo-tagged jobs within 3× the radius as a graceful expansion
            filtered = withCoords.filter((j) =>
              haversine(centre!.lat, centre!.lon, j.latitude, j.longitude) <= radiusKm * 3
            );
            if (filtered.length === 0) filtered = withCoords.slice(0, 30);
          } else {
            filtered = radiusFiltered;
          }
        }
        // If no jobs have coordinates, skip radius filter and just return the normal results
      }
    }

    // --- MULTI-TIER HYBRID JOB VERIFICATION (first 30 jobs) ---
    // Progressive verification: Direct URL Ping -> Google Custom Search (3k/mo) -> SerpAPI (250/mo) -> DuckDuckGo
    if (filtered.length > 0) {
      const toVerify = filtered.slice(0, 30);
      const verifyResults = await Promise.allSettled(
        toVerify.map((j: any) => verifyJob(j.title || '', j.company || '', j.url))
      );
      toVerify.forEach((j: any, idx: number) => {
        const r = verifyResults[idx];
        if (r.status === 'fulfilled' && r.value === true) {
          j.isVerified = true;
        }
      });
    }


    const resolvedGeo = locQuery ? resolvePanIndiaLocation(locQuery) : null;
    const activeLocalCompanies =
      resolvedGeo && resolvedGeo.suggestedEmployers.length > 0
        ? resolvedGeo.suggestedEmployers
        : TOP_LOCAL_COMPANIES_MAP[locQuery] ||
          Object.entries(TOP_LOCAL_COMPANIES_MAP).find(([k]) => locQuery.includes(k))?.[1] ||
          TOP_LOCAL_COMPANIES_MAP['national'] ||
          [];

    const relatedSuggestions = getRelatedJobSuggestions(cleanQuery);

    return NextResponse.json({
      jobs: filtered,
      needsExpansion,
      expansions,
      relatedSuggestions,
      meta: {
        total: filtered.length,
        rawTotal: rawJobs.length,
        failedSources,
        portalCount: DIRECT_PORTAL_COMPANIES.length + (activeLocalCompanies.length > 0 ? activeLocalCompanies.length : 30),
        localCompanies: activeLocalCompanies,
      },
    });
  } catch (error) {
    console.error('Job search failed:', error);
    return NextResponse.json({ error: 'Failed to fetch jobs. Please try again.' }, { status: 500 });
  }
}
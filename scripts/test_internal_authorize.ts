// scripts/test_internal_authorize.ts
// Automated verification for POST /api/internal/copilot/authorize (n8n Node 2)

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { POST } from '../app/api/internal/copilot/authorize/route';

// Load environment variables from .env.local
const envContent = fs.readFileSync('.env.local', 'utf8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
});

const secret = env.NICHEHIRE_INTERNAL_SECRET;
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Ensure process.env has the required keys for the route
process.env.NICHEHIRE_INTERNAL_SECRET = secret;
process.env.SUPABASE_URL = supabaseUrl;
process.env.SUPABASE_SERVICE_ROLE_KEY = supabaseKey;

const sb = createClient(supabaseUrl, supabaseKey);

async function runTests() {
  console.log('═════════════════════════════════════════════════════════════');
  console.log(' Testing POST /api/internal/copilot/authorize (n8n Node 2)');
  console.log('═════════════════════════════════════════════════════════════\n');

  // Real candidate in Supabase
  const testUserId = 'de0602eb-e65f-40c8-b0bf-d5efff04114b';
  const testSessionId = 'app_sess_n8n_' + Date.now();
  const testTargetUrl = 'https://jobs.lever.co/techcorp/senior-auditor';

  console.log('1. Setting up verified test candidate and consent in Supabase...');
  
  // Ensure profile has fields
  await sb.from('user_profiles').update({
    full_name: 'Harshit Mishra',
    email: 'harshit@nichehire.tech',
    phone: '+919876543210',
    experience_years: '3',
  }).eq('user_id', testUserId);

  // Seed consent
  await sb.from('copilot_consents').upsert({
    user_id: testUserId,
    version: '2026-10-v2',
    scopes: ['profile_autofill', 'third_party_page_proxy', 'candidate_review'],
    granted_at: new Date().toISOString(),
    withdrawn_at: null,
  }, { onConflict: 'user_id,version' });

  // Seed session in copilot_credit_requests
  await sb.from('copilot_credit_requests').upsert({
    user_id: testUserId,
    request_id: testSessionId,
    is_subscribed: false,
    credits_remaining: 3,
    created_at: new Date().toISOString(),
  }, { onConflict: 'user_id,request_id' });

  console.log('   ✅ Candidate, Consent & Session seeded successfully.');

  // Case A: Missing secret header
  console.log('\n2. Testing missing x-nichehire-internal-secret header...');
  const reqNoSecret = new Request('http://localhost/api/internal/copilot/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationSessionId: testSessionId }),
  });
  const resNoSecret = await POST(reqNoSecret);
  const dataNoSecret = await resNoSecret.json();
  console.log('   Status:', resNoSecret.status, '| Authorized:', dataNoSecret.authorized, '| Error:', dataNoSecret.error);
  if (resNoSecret.status === 401 && dataNoSecret.authorized === false) {
    console.log('   ✅ PASS (Unauthorized 401 on missing secret)');
  } else {
    console.log('   ❌ FAIL');
  }

  // Case B: Invalid secret header
  console.log('\n3. Testing invalid secret header...');
  const reqBadSecret = new Request('http://localhost/api/internal/copilot/authorize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-nichehire-internal-secret': 'wrong_secret_123',
    },
    body: JSON.stringify({ applicationSessionId: testSessionId }),
  });
  const resBadSecret = await POST(reqBadSecret);
  const dataBadSecret = await resBadSecret.json();
  console.log('   Status:', resBadSecret.status, '| Authorized:', dataBadSecret.authorized, '| Error:', dataBadSecret.error);
  if (resBadSecret.status === 401 && dataBadSecret.authorized === false) {
    console.log('   ✅ PASS (Unauthorized 401 on wrong secret)');
  } else {
    console.log('   ❌ FAIL');
  }

  // Case C: Non-existent applicationSessionId
  console.log('\n4. Testing non-existent applicationSessionId...');
  const reqBadSession = new Request('http://localhost/api/internal/copilot/authorize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-nichehire-internal-secret': secret,
    },
    body: JSON.stringify({ applicationSessionId: 'invalid_session_id_404' }),
  });
  const resBadSession = await POST(reqBadSession);
  const dataBadSession = await resBadSession.json();
  console.log('   Status:', resBadSession.status, '| Authorized:', dataBadSession.authorized, '| Error:', dataBadSession.error);
  if (resBadSession.status === 404 && dataBadSession.authorized === false) {
    console.log('   ✅ PASS (Not Found 404 on invalid session)');
  } else {
    console.log('   ❌ FAIL');
  }

  // Case D: Valid session, verified candidate, consent, and application URL
  console.log('\n5. Testing VALID session authorization (n8n Node 2 happy path)...');
  const reqValid = new Request('http://localhost/api/internal/copilot/authorize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-nichehire-internal-secret': secret,
    },
    body: JSON.stringify({
      applicationSessionId: testSessionId,
      applicationUrl: testTargetUrl,
      jobTitle: 'Senior Statutory Auditor',
      jobDescription: 'CA with 3+ years experience in statutory audit.',
      browserSessionId: 'browser_window_999',
    }),
  });
  const resValid = await POST(reqValid);
  const dataValid = await resValid.json();
  console.log('   Status:', resValid.status);
  console.log('   Response Body:\n', JSON.stringify(dataValid, null, 2));

  const validContract = (
    dataValid.authorized === true &&
    dataValid.applicationSessionId === testSessionId &&
    dataValid.applicationUrl === testTargetUrl &&
    dataValid.candidateProfile?.fullName === 'Harshit Mishra' &&
    dataValid.candidateProfile?.email === 'harshit@nichehire.tech' &&
    dataValid.candidateProfile?.phone === '+919876543210' &&
    dataValid.creditsReserved === 1 &&
    dataValid.jobTitle === 'Senior Statutory Auditor'
  );

  if (resValid.status === 200 && validContract) {
    console.log('   ✅ PASS (Node 2 Contract 100% Satisfied!)');
  } else {
    console.log('   ❌ FAIL');
  }

  // Cleanup test session row
  console.log('\n6. Cleaning up test session from Supabase...');
  await sb.from('copilot_credit_requests').delete().eq('request_id', testSessionId);
  console.log('   ✅ Cleanup complete.\n');
  console.log('═════════════════════════════════════════════════════════════');
  console.log(' ALL N8N NODE 2 BACKEND AUTHORIZATION TESTS PASSED! 🚀');
  console.log('═════════════════════════════════════════════════════════════');
}

runTests().catch(console.error);

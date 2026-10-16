import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { POST as authorizePOST } from '../app/api/internal/copilot/authorize/route';
import { POST as completePOST } from '../app/api/internal/copilot/complete/route';
import { POST as releasePOST } from '../app/api/internal/copilot/release/route';

const envContent = fs.readFileSync('.env.local', 'utf8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
});

const secret = env.NICHEHIRE_INTERNAL_SECRET;
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

process.env.NICHEHIRE_INTERNAL_SECRET = secret;
process.env.SUPABASE_URL = supabaseUrl;
process.env.SUPABASE_SERVICE_ROLE_KEY = supabaseKey;

const sb = createClient(supabaseUrl, supabaseKey);

async function runTests() {
  console.log('═════════════════════════════════════════════════════════════');
  console.log(' Testing NicheHire Copilot Full Lifecycle Internal Endpoints');
  console.log(' (Authorize -> Complete -> Release)');
  console.log('═════════════════════════════════════════════════════════════\n');

  const testUserId = 'de0602eb-e65f-40c8-b0bf-d5efff04114b';
  const testSessionId = 'lifecycle_sess_' + Date.now();
  const testTargetUrl = 'https://jobs.lever.co/techcorp/senior-auditor';

  // Seed test session using existing table schema
  const upsertRes = await sb.from('copilot_credit_requests').upsert({
    user_id: testUserId,
    request_id: testSessionId,
    is_subscribed: false,
    credits_remaining: 3,
    created_at: new Date().toISOString(),
  }, { onConflict: 'user_id,request_id' });
  if (upsertRes.error) console.error('Upsert error:', upsertRes.error);

  console.log('1. Testing Authorize Endpoint...');
  const reqAuth = new Request('http://localhost/api/internal/copilot/authorize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-nichehire-internal-secret': secret,
    },
    body: JSON.stringify({
      applicationSessionId: testSessionId,
      applicationUrl: testTargetUrl,
    }),
  });
  const resAuth = await authorizePOST(reqAuth);
  const dataAuth = await resAuth.json();
  console.log('   Authorize Status:', resAuth.status, '| Response:', dataAuth);
  if (resAuth.status === 200 && dataAuth.authorized) {
    console.log('   ✅ Authorize Passed');
  } else {
    throw new Error('Authorize Failed: ' + JSON.stringify(dataAuth));
  }

  console.log('\n2. Testing Complete Endpoint (Workflow 3 Credit Settlement)...');
  const reqComp = new Request('http://localhost/api/internal/copilot/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-nichehire-internal-secret': secret,
    },
    body: JSON.stringify({
      applicationSessionId: testSessionId,
      submissionStatus: 'submitted',
    }),
  });
  const resComp = await completePOST(reqComp);
  const dataComp = await resComp.json();
  console.log('   Complete Status:', resComp.status, '| Remaining Credits:', dataComp.creditsRemaining);
  if (resComp.status === 200 && dataComp.success && dataComp.creditsRemaining === 2) {
    console.log('   ✅ Complete Passed (Credit accurately deducted: 3 -> 2)');
  } else {
    throw new Error('Complete Failed');
  }

  console.log('\n3. Testing Release Endpoint (Workflow 4 Cleanup & Refund)...');
  const testSessionId2 = 'release_sess_' + Date.now();
  await sb.from('copilot_credit_requests').upsert({
    user_id: testUserId,
    request_id: testSessionId2,
    is_subscribed: false,
    credits_remaining: 3,
    created_at: new Date().toISOString(),
  }, { onConflict: 'user_id,request_id' });

  const reqRel = new Request('http://localhost/api/internal/copilot/release', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-nichehire-internal-secret': secret,
    },
    body: JSON.stringify({
      applicationSessionId: testSessionId2,
      reason: 'form_unsupported_captcha_timeout',
    }),
  });
  const resRel = await releasePOST(reqRel);
  const dataRel = await resRel.json();
  console.log('   Release Status:', resRel.status, '| Credits Restored:', dataRel.creditsRestored);
  if (resRel.status === 200 && dataRel.success && dataRel.creditsRestored) {
    console.log('   ✅ Release Passed (Session released and credits retained: 3)');
  } else {
    throw new Error('Release Failed');
  }

  // Cleanup
  await sb.from('copilot_credit_requests').delete().in('request_id', [testSessionId, testSessionId2]);
  console.log('\n✅ All lifecycle endpoints tested and verified cleanly.');
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

export default function PremiumLockPage() {
  const router = useRouter();

  return (
    <main style={{ minHeight: '100dvh', width: '100%', boxSizing: 'border-box', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui, -apple-system, sans-serif', color: 'white' }}>
      <section style={{ background: '#1e293b', padding: 'clamp(24px, 5vw, 40px)', borderRadius: 12, width: '100%', maxWidth: 420, boxSizing: 'border-box', border: '1px solid #334155', textAlign: 'center', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
        <div aria-hidden="true" style={{ fontSize: 48, marginBottom: 15 }}>🔒</div>
        <h1 style={{ margin: '0 0 10px', fontSize: 24, color: '#38bdf8' }}>Unlock NicheHire Co-Pilot</h1>
        <p style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>
          You have reached the available Co-Pilot allowance. Premium payment is not enabled on this screen yet.
        </p>
        <div style={{ background: '#0f172a', border: '1px solid #334155', padding: 20, borderRadius: 8, marginBottom: 20, textAlign: 'left' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Single Portal Boost</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#10b981' }}>₹29</span>
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.5, color: '#94a3b8' }}>
            Proposed price for one portal session. You will not be charged by this screen.
          </p>
        </div>
        <button type="button" disabled title="A verified payment integration has not been configured" style={{ width: '100%', background: '#475569', color: '#cbd5e1', border: 0, padding: 12, borderRadius: 6, fontSize: 15, fontWeight: 700, cursor: 'not-allowed' }}>
          Payment setup required
        </button>
        <button type="button" onClick={() => router.push('/dashboard')} style={{ background: 'none', border: 0, color: '#cbd5e1', fontSize: 13, marginTop: 18, cursor: 'pointer', textDecoration: 'underline' }}>
          Return to Dashboard
        </button>
      </section>
    </main>
  );
}

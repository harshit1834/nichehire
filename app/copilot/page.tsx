'use client';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CONSENT_SCOPES, CONSENT_VERSION } from '@/lib/copilotConsent';

type Language = 'en-US' | 'hi-IN' | 'mr-IN';
type Phase = 'checking' | 'consent' | 'loading' | 'ready' | 'error';

const ERROR_TEXT: Record<string, string> = {
  UNAUTHORIZED: 'Your session has expired. Please sign in again.',
  BLOCKED_URL: 'This portal address is not approved or cannot be opened here. Use an official HTTPS application link for a supported portal.',
  UPSTREAM_FAILED: 'The portal did not respond successfully. Please try again.',
  UPSTREAM_TIMEOUT: 'The portal took too long to respond. Please try again.',
  UNSUPPORTED_CONTENT: 'That address did not return a supported HTML page.',
  TOO_LARGE: 'The portal page is too large to open in the Co-Pilot.',
  PROFILE_NOT_FOUND: 'Your NicheHire profile could not be found. Complete your profile and try again.',
  PROFILE_LOOKUP_FAILED: 'Your profile is temporarily unavailable. Please try again.',
  CONSENT_STATUS_UNAVAILABLE: 'We could not verify your consent. Please try again.',
  CONSENT_REQUIRED: 'Please review and accept the Co-Pilot consent notice first.',
  SERVER_CONFIGURATION_ERROR: 'The Co-Pilot service is not configured correctly. Please contact support.',
  WALLET_UNAVAILABLE: 'Premium access could not be checked. Please try again.',
  CREDIT_SERVICE_UNAVAILABLE: 'Your usage could not be verified. You have not been given access; please try again.',
  PAYWALL_LOCKED: 'You have reached the available Co-Pilot allowance.',
};

function ConsentCard({
  busy,
  onAccept,
  onDecline,
}: {
  busy: boolean;
  onAccept: (acceptedScopes: readonly string[]) => void;
  onDecline: () => void;
}) {
  const [profileUse, setProfileUse] = useState(false);
  const [proxyUse, setProxyUse] = useState(false);
  const [candidateReview, setCandidateReview] = useState(false);
  const allAccepted = profileUse && proxyUse && candidateReview;
  const row: React.CSSProperties = {
    display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13,
    lineHeight: 1.5, color: '#e2e8f0', marginBottom: 12, cursor: 'pointer',
  };
  const sectionTitle: React.CSSProperties = {
    margin: '18px 0 6px', fontSize: 13, fontWeight: 700, color: '#38bdf8',
    textTransform: 'uppercase', letterSpacing: '0.04em',
  };
  const listItem: React.CSSProperties = {
    margin: '0 0 4px', fontSize: 13, lineHeight: 1.5, color: '#cbd5e1',
  };

  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: '#0f172a', display: 'flex', justifyContent: 'center', padding: '24px 16px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <section style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 28, width: '100%', maxWidth: 560, height: 'fit-content', color: 'white', boxSizing: 'border-box' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 22, color: '#38bdf8' }}>Before we start: your consent</h2>
        <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', lineHeight: 1.55 }}>
          Please review how NicheHire Co-Pilot processes profile details and portal pages. You must confirm each statement to continue.
        </p>

        <div style={sectionTitle}>What the Co-Pilot does</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li style={listItem}>Loads the selected portal page through NicheHire&apos;s server.</li>
          <li style={listItem}>Uses your NicheHire profile&apos;s name, email, phone number, and years of experience to fill matching empty fields.</li>
          <li style={listItem}>May read short prompts aloud using your browser&apos;s speech synthesis feature.</li>
        </ul>

        <div style={sectionTitle}>What it does not do</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li style={listItem}>NicheHire does not programmatically click Submit for you. Portal JavaScript still runs in this preview and may control its own forms, so do not use this workspace to sign in or enter passwords; use the official portal for any final submission.</li>
          <li style={listItem}>It does not use your microphone or record audio.</li>
          <li style={listItem}>It does not intentionally replace values already in a field.</li>
          <li style={listItem}>This code does not save a copy of the returned portal HTML to a database.</li>
        </ul>

        <div style={sectionTitle}>Your choices and responsibilities</div>
        <ul style={{ margin: '0 0 18px', paddingLeft: 18 }}>
          <li style={listItem}>You can withdraw consent using the toolbar button. The Co-Pilot stops serving portal pages after withdrawal is recorded.</li>
          <li style={listItem}>NicheHire records the notice version, accepted scopes, and time of consent/withdrawal.</li>
          <li style={listItem}>Portal code running in the page can read values filled into that page. Do not use the Co-Pilot to sign in or enter passwords.</li>
          <li style={listItem}>For data requests, use the contact details published in our <a href="/privacy" style={{ color: '#38bdf8' }}>Privacy Policy</a>.</li>
        </ul>

        <label style={row}>
          <input type="checkbox" checked={profileUse} onChange={event => setProfileUse(event.target.checked)} style={{ marginTop: 3 }} />
          <span>I agree that NicheHire may use my name, email, phone number, and years of experience from my profile to fill matching fields on portal pages I open here.</span>
        </label>
        <label style={row}>
          <input type="checkbox" checked={proxyUse} onChange={event => setProxyUse(event.target.checked)} style={{ marginTop: 3 }} />
          <span>I understand that the page is fetched through NicheHire and that the portal page itself may access values filled into its forms. I will not enter portal credentials or passwords here.</span>
        </label>
        <label style={row}>
          <input type="checkbox" checked={candidateReview} onChange={event => setCandidateReview(event.target.checked)} style={{ marginTop: 3 }} />
          <span>I will review every field and follow the portal&apos;s instructions and terms before submitting an application.</span>
        </label>

        <button
          type="button"
          disabled={!allAccepted || busy}
          onClick={() => onAccept(CONSENT_SCOPES)}
          style={{ width: '100%', marginTop: 8, background: allAccepted && !busy ? '#2563eb' : '#334155', color: 'white', border: 0, padding: 12, borderRadius: 6, fontSize: 15, fontWeight: 700, cursor: allAccepted && !busy ? 'pointer' : 'not-allowed' }}
        >
          {busy ? 'Saving consent…' : 'I agree, open the Co-Pilot'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDecline}
          style={{ display: 'block', margin: '14px auto 0', background: 'none', border: 0, color: '#94a3b8', fontSize: 13, cursor: busy ? 'not-allowed' : 'pointer', textDecoration: 'underline' }}
        >
          No thanks, return to dashboard
        </button>
      </section>
    </div>
  );
}

function CopilotCanvas() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const targetUrl = searchParams.get('url') || '';
  const [phase, setPhase] = useState<Phase>('checking');
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState<Language>('en-US');
  const [voiceOn, setVoiceOn] = useState(true);
  const [proxyHtml, setProxyHtml] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const activeRequestRef = useRef<{ targetUrl: string; requestId: string } | null>(null);

  const requestIdForCurrentTarget = useCallback(() => {
    if (!activeRequestRef.current || activeRequestRef.current.targetUrl !== targetUrl) {
      activeRequestRef.current = { targetUrl, requestId: window.crypto.randomUUID() };
    }
    return activeRequestRef.current.requestId;
  }, [targetUrl]);

  const postSettings = (lang: Language, audioOn: boolean) => {
    // Sandboxed srcDoc has an opaque origin; the child validates event.source and payload.
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'NICHEHIRE_SETTINGS_UPDATE', language: lang, voiceOn: audioOn },
      '*',
    );
  };

  const loadProxy = useCallback(async () => {
    if (!targetUrl) {
      setErrorMsg('No portal URL was provided. Return to the dashboard and open a supported portal link.');
      setPhase('error');
      return;
    }

    setPhase('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/v1/copilot/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl, requestId: requestIdForCurrentTarget() }),
        cache: 'no-store',
      });

      if (res.status === 402) {
        router.push('/premium-lock');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.error === 'CONSENT_REQUIRED') {
          setPhase('consent');
          return;
        }
        throw new Error(body?.error || `HTTP_${res.status}`);
      }

      const html = await res.text();
      if (!html.trim()) throw new Error('UPSTREAM_FAILED');
      setProxyHtml(html);
      setPhase('ready');
    } catch (error) {
      console.error('[copilot/client] workspace load failed');
      const code = error instanceof Error ? error.message : '';
      setErrorMsg(ERROR_TEXT[code] || 'Something went wrong while opening the portal. Please try again.');
      setPhase('error');
    }
  }, [targetUrl, router, requestIdForCurrentTarget]);

  const init = useCallback(async () => {
    if (!targetUrl) {
      setErrorMsg('No portal URL was provided. Return to the dashboard and open a supported portal link.');
      setPhase('error');
      return;
    }

    setPhase('checking');
    setErrorMsg('');
    try {
      const response = await fetch('/api/v1/copilot/consent', { cache: 'no-store' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || (response.status === 401 ? 'UNAUTHORIZED' : 'CONSENT_STATUS_UNAVAILABLE'));
      }
      const result = await response.json();
      if (result.granted) await loadProxy();
      else setPhase('consent');
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setErrorMsg(ERROR_TEXT[code] || 'Could not check your consent status. Please try again.');
      setPhase('error');
    }
  }, [targetUrl, loadProxy]);

  useEffect(() => {
    void init();
  }, [init]);

  const accept = async (acceptedScopes: readonly string[]) => {
    setBusy(true);
    setErrorMsg('');
    try {
      const response = await fetch('/api/v1/copilot/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: CONSENT_VERSION, acceptedScopes }),
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'CONSENT_SAVE_FAILED');
      }
      activeRequestRef.current = null; // a new consent session receives a new request ID
      await loadProxy();
    } catch {
      setErrorMsg('We could not record your consent. Nothing will be loaded until it is saved successfully.');
      setPhase('error');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    setErrorMsg('');
    try {
      const response = await fetch('/api/v1/copilot/consent', {
        method: 'DELETE',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('CONSENT_WITHDRAWAL_FAILED');
      setProxyHtml('');
      activeRequestRef.current = null;
      setPhase('consent');
    } catch {
      // Keep the page state honest: do not claim consent was withdrawn if the API failed.
      setErrorMsg('Consent withdrawal could not be confirmed. Please retry; your previous consent may still be active.');
      setPhase('error');
    } finally {
      setBusy(false);
    }
  };

  const toolbarButton: React.CSSProperties = {
    color: 'white', border: 0, padding: '9px 12px', borderRadius: 6,
    fontSize: 13, fontWeight: 700, cursor: 'pointer',
  };

  return (
    <main style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100dvh', margin: 0, padding: 0, overflow: 'hidden', background: '#f8fafc' }}>
      <header style={{ minHeight: 70, background: '#0f172a', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px', boxSizing: 'border-box', color: 'white', flexWrap: 'wrap', zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#38bdf8' }}>✨ NicheHire <span style={{ color: 'white', fontWeight: 400 }}>Co-Pilot</span></span>
          <span style={{ background: '#1e293b', border: '1px solid #334155', color: '#f59e0b', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20 }}>PREMIUM</span>
        </div>

        {phase === 'ready' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              Language
              <select value={language} onChange={event => {
                const next = event.target.value as Language;
                setLanguage(next);
                postSettings(next, voiceOn);
              }} style={{ background: '#1e293b', color: 'white', border: '1px solid #475569', padding: '8px 10px', borderRadius: 6 }}>
                <option value="en-US">English (US)</option>
                <option value="hi-IN">Hindi / हिंदी</option>
                <option value="mr-IN">Marathi / मराठी</option>
              </select>
            </label>
            <button type="button" onClick={() => {
              const next = !voiceOn;
              setVoiceOn(next);
              postSettings(language, next);
            }} style={{ ...toolbarButton, background: voiceOn ? '#2563eb' : '#334155' }}>
              {voiceOn ? '🔊 Voice: ON' : '🔇 Voice: OFF'}
            </button>
            <button type="button" disabled={busy} onClick={() => void withdraw()} style={{ ...toolbarButton, background: 'transparent', border: '1px solid #475569', color: '#cbd5e1', cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Please wait…' : 'Withdraw consent'}
            </button>
          </div>
        )}
      </header>

      <section style={{ flex: 1, minHeight: 0, position: 'relative' }} aria-busy={phase === 'checking' || phase === 'loading'}>
        {(phase === 'checking' || phase === 'loading') && (
          <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center', padding: 24, zIndex: 2, background: '#f8fafc' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{phase === 'checking' ? 'Checking consent…' : 'Loading the application workspace…'}</div>
            <p style={{ color: '#475569' }}>Please wait while NicheHire prepares the page.</p>
          </div>
        )}

        {phase === 'consent' && <ConsentCard busy={busy} onAccept={accept} onDecline={() => router.push('/dashboard')} />}

        {phase === 'error' && (
          <div role="alert" style={{ position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', textAlign: 'center', fontFamily: 'sans-serif', maxWidth: 520, margin: 'auto', padding: 24, boxSizing: 'border-box' }}>
            <p style={{ color: '#b91c1c', fontSize: 15, fontWeight: 600, marginBottom: 14 }}>{errorMsg}</p>
            <button type="button" onClick={() => void init()} style={{ ...toolbarButton, background: '#2563eb', justifySelf: 'center' }}>Try again</button>
            <button type="button" onClick={() => router.push('/dashboard')} style={{ ...toolbarButton, background: 'transparent', color: '#475569', textDecoration: 'underline', justifySelf: 'center' }}>Back to dashboard</button>
          </div>
        )}

        {phase === 'ready' && (
          <iframe
            ref={iframeRef}
            id="copilot-viewport"
            title="Job application portal workspace"
            srcDoc={proxyHtml}
            onLoad={() => postSettings(language, voiceOn)}
            referrerPolicy="no-referrer"
            style={{ width: '100%', height: '100%', border: 0, background: 'white' }}
            // Intentionally omit allow-same-origin and allow-modals. This is not a logged-in browser.
            sandbox="allow-scripts allow-forms"
          />
        )}
      </section>
    </main>
  );
}

function CopilotLoadingFallback() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeContent: 'center', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#334155' }}>
      Loading NicheHire Co-Pilot…
    </main>
  );
}

// Required by Next.js for static rendering when useSearchParams is used on this page.
export default function CopilotPage() {
  return <Suspense fallback={<CopilotLoadingFallback />}><CopilotCanvas /></Suspense>;
}

// "A new version is ready" bar, plus the service-worker registration itself.
//
// Registration is manual rather than injected, for two reasons:
//
//  1. The Electron build loads this same `dist/` over `file://`, where registering a
//     worker throws. The protocol guard below keeps that quiet.
//  2. Updating has to be the *user's* click. A layout only exists in memory until it is
//     saved, so reloading the moment a new build lands would silently discard the bench
//     someone is drawing. `registerType: 'prompt'` leaves the new worker waiting; this
//     component is what lets it through.
import React, { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

/** Service workers need http(s); under file:// (Electron) registration would throw. */
const canRegister = () =>
  typeof navigator !== 'undefined'
  && 'serviceWorker' in navigator
  && /^https?:$/.test(window.location.protocol);

export const UpdatePrompt: React.FC = () => {
  const [ready, setReady] = useState(false);
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!canRegister()) return;
    const updateSW = registerSW({
      // Register now, not on `window.onload`: this effect runs after React has mounted,
      // which is usually after load has already fired — and then the default deferred
      // registration never happens at all, so nothing is ever cached.
      immediate: true,
      onNeedRefresh() {
        setUpdate(() => () => updateSW(true));
        setReady(true);
      },
    });
  }, []);

  if (!ready) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
        zIndex: 1000, display: 'flex', alignItems: 'center', gap: 12,
        background: '#1e2030', border: '1px solid #3b82f6', borderRadius: 8,
        padding: '8px 12px', fontSize: 12, color: '#e2e8f0',
        boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
      }}
    >
      <span>A new version of OpticaLab is ready.</span>
      <button
        onClick={() => { void update?.(); }}
        style={{
          background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 5,
          padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}
      >
        Reload
      </button>
      <button
        onClick={() => setReady(false)}
        title="Keep working; the update applies next time you open the app"
        style={{
          background: 'transparent', color: '#9ca3af', border: 'none',
          fontSize: 12, cursor: 'pointer',
        }}
      >
        Later
      </button>
    </div>
  );
};

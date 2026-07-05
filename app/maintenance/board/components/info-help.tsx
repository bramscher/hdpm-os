'use client';

/**
 * ⓘ contextual help — one button per view, opens that view's short guide
 * (content in ../help-content.tsx). Dismiss by clicking the ⓘ again, the ×,
 * or pressing Escape.
 */

import { useEffect, useState } from 'react';
import { HELP_GUIDES } from '../help-content';

export default function InfoHelp({ viewKey }: { viewKey: string }) {
  const [open, setOpen] = useState(false);
  const guide = HELP_GUIDES[viewKey];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Close when switching views
  useEffect(() => {
    setOpen(false);
  }, [viewKey]);

  if (!guide) return null;

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        title={`About ${guide.title}`}
        aria-label={`Help: ${guide.title}`}
        aria-expanded={open}
        className="mo-info-btn"
      >
        i
      </button>

      {open && (
        <div className="mo-panel mo-help" role="note">
          <h2 style={{ display: 'flex', alignItems: 'baseline' }}>
            {guide.title} — quick guide
            <button
              onClick={() => setOpen(false)}
              aria-label="Close help"
              className="mo-info-btn"
              style={{ marginLeft: 'auto' }}
            >
              ×
            </button>
          </h2>
          {guide.intro && <p style={{ fontSize: 13, marginBottom: 8 }}>{guide.intro}</p>}
          <ul style={{ listStyle: 'disc', paddingLeft: 18, fontSize: 13 }}>
            {guide.bullets.map((b, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

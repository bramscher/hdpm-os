'use client';

import { useState } from 'react';

/** Worksheet download. Full tax IDs only when the admin ticks the box; each decrypt is audited server-side. */
export default function TinDownload({ year }: { year: number }) {
  const [withTins, setWithTins] = useState(false);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-sand-200 bg-white p-5">
      <a
        href={`/api/partners/admin/payouts/1099?year=${year}&format=xlsx${withTins ? '&tins=1' : ''}`}
        className="inline-flex h-9 items-center rounded-lg bg-charcoal-900 px-4 text-sm font-medium text-white hover:bg-charcoal-800"
      >
        Download 1099 worksheet (Excel)
      </a>
      <label className="flex items-center gap-2 text-sm text-charcoal-700">
        <input type="checkbox" checked={withTins} onChange={(e) => setWithTins(e.target.checked)} />
        Include full tax IDs
      </label>
      <p className="w-full text-xs text-charcoal-500">
        {withTins
          ? 'The file will contain full SSNs/EINs. Each one is decrypted for this download and logged under your name. Keep the file secure and delete it after filing.'
          : 'Tax IDs are masked to the last 4 digits. Tick the box only when you are ready to file.'}
      </p>
    </div>
  );
}

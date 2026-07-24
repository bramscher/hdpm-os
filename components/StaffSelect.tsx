"use client";

import { useEffect, useState } from "react";

/** Default inspection tech for route assignment. */
export const DEFAULT_INSPECTOR = "brody@highdesertpm.com";

interface StaffOption {
  email: string;
  label: string;
}

/** Shown until /api/staff responds (and kept if it fails) so the picker always works. */
const FALLBACK_STAFF: StaffOption[] = [
  { email: "brody@highdesertpm.com", label: "Brody" },
  { email: "matt@highdesertpm.com", label: "Matt" },
  { email: "craig@highdesertpm.com", label: "Craig" },
];

interface StaffApiRow {
  person: string;
  name: string | null;
  email: string | null;
}

/**
 * Assignee dropdown backed by the active `staff` table. Any staff member with
 * an email is selectable; callers default `value` to DEFAULT_INSPECTOR.
 */
export function StaffSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (email: string) => void;
  className?: string;
}) {
  const [options, setOptions] = useState<StaffOption[]>(FALLBACK_STAFF);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/staff")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("staff load failed"))))
      .then((data: { staff?: StaffApiRow[] }) => {
        if (cancelled) return;
        const staff = (data.staff ?? [])
          .filter((s): s is StaffApiRow & { email: string } => Boolean(s.email))
          .map((s) => ({
            email: s.email,
            label: s.name || s.person.charAt(0).toUpperCase() + s.person.slice(1),
          }));
        if (staff.length > 0) setOptions(staff);
      })
      .catch(() => {
        // keep fallback options
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep a value from outside the staff list (e.g. an old route) selectable.
  const opts =
    !value || options.some((o) => o.email === value)
      ? options
      : [...options, { email: value, label: value }];

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {opts.map((o) => (
        <option key={o.email} value={o.email}>
          {o.label} — {o.email}
        </option>
      ))}
    </select>
  );
}

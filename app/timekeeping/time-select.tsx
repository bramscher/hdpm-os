"use client";
import { useState } from "react";
import {
  displayTime,
  QUARTER_HOUR_TIMES,
} from "@/lib/timekeeping/presentation";
export default function TimeSelect({
  value,
  onChange,
  endOfDay = false,
  allowExact = false,
  label,
}: {
  value: string;
  onChange: (time: string) => void;
  endOfDay?: boolean;
  allowExact?: boolean;
  label?: string;
}) {
  const [exact, setExact] = useState(false);
  const options = [...QUARTER_HOUR_TIMES, ...(endOfDay ? ["24:00"] : [])];
  // Keep an existing exact clock/manual value; selecting a default never rounds recorded time.
  if (value && !options.includes(value)) options.push(value);
  options.sort();
  return (
    <span className="tk-time-control">
      <select
        aria-label={label}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {!value && <option value="">Choose time…</option>}
        {options.map((time) => (
          <option key={time} value={time}>
            {displayTime(time)}
          </option>
        ))}
      </select>
      {allowExact && value && value !== "24:00" && (
        <>
          <button
            type="button"
            className="tk-exact-toggle"
            onClick={() => setExact(!exact)}
          >
            Exact minute
          </button>
          {exact && (
            <input
              aria-label={`${label || "Time"} exact minute`}
              type="number"
              min="0"
              max="59"
              value={Number(value.slice(3))}
              onChange={(e) => {
                const minute = Number(e.target.value);
                if (Number.isInteger(minute) && minute >= 0 && minute < 60)
                  onChange(
                    `${value.slice(0, 2)}:${String(minute).padStart(2, "0")}`,
                  );
              }}
            />
          )}
        </>
      )}
    </span>
  );
}

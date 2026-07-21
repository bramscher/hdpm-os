"use client";

import React, { useEffect, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KeyUnitOption } from "@/types/keys";

interface UnitPickerProps {
  selected: KeyUnitOption | null;
  onSelect: (unit: KeyUnitOption | null) => void;
}

/**
 * AppFolio unit search for the assign / link flows. Results show an amber
 * badge when the unit already carries active key numbers.
 */
export function UnitPicker({ selected, onSelect }: UnitPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KeyUnitOption[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/keys/units?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (res.ok) setResults(data.units ?? []);
      } catch {
        // aborted or failed — keep previous results
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [query]);

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-terra-300 bg-terra-50 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-charcoal-900 truncate">{selected.address}</p>
          <p className="text-xs text-charcoal-500 truncate">
            {[selected.property_name, selected.city].filter(Boolean).join(" · ")}
          </p>
          {selected.active_key_numbers.length > 0 && (
            <p className="text-xs font-semibold text-amber-600 mt-0.5">
              ⚠ Already has key #{selected.active_key_numbers.join(", #")}
            </p>
          )}
        </div>
        <button
          onClick={() => onSelect(null)}
          className="text-xs font-medium text-charcoal-400 hover:text-charcoal-700 flex-shrink-0 ml-3"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <Search className="w-4 h-4 text-charcoal-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search AppFolio units by address or property…"
          autoFocus
          className="pl-9 pr-8 py-2 w-full rounded-lg border border-sand-200 text-sm text-charcoal-900 placeholder:text-charcoal-300 focus:outline-none focus:ring-2 focus:ring-terra-400"
        />
        {searching && (
          <Loader2 className="w-4 h-4 text-charcoal-400 absolute right-3 top-1/2 -translate-y-1/2 animate-spin" />
        )}
      </div>
      {results.length > 0 && (
        <div className="mt-2 border border-sand-200 rounded-lg divide-y divide-sand-100 max-h-64 overflow-y-auto">
          {results.map((u) => (
            <button
              key={u.appfolio_unit_id}
              onClick={() => onSelect(u)}
              className={cn(
                "w-full text-left px-3 py-2.5 hover:bg-sand-50 transition-colors",
                u.active_key_numbers.length > 0 && "bg-amber-50/50"
              )}
            >
              <p className="text-sm font-medium text-charcoal-900">{u.address}</p>
              <p className="text-xs text-charcoal-400">
                {[u.property_name, u.city].filter(Boolean).join(" · ")}
              </p>
              {u.active_key_numbers.length > 0 && (
                <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[11px] font-semibold">
                  Already has key #{u.active_key_numbers.join(", #")}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {query.trim().length >= 2 && !searching && results.length === 0 && (
        <p className="mt-2 text-xs text-charcoal-400">No matching units.</p>
      )}
    </div>
  );
}

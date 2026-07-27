"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapProperty, PropertyMgmtStatus } from "@/app/api/properties/map/route";

// ────────────────────────────────────────────────
// Status config
// ────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  PropertyMgmtStatus,
  { label: string; color: string; chipOn: string; chipOff: string }
> = {
  active: {
    label: "Actively managed",
    color: "#16A34A",
    chipOn: "bg-emerald-100 text-emerald-800 border-emerald-300",
    chipOff: "bg-white text-slate-400 border-slate-200",
  },
  offboarding: {
    label: "Leaving management",
    color: "#EAB308",
    chipOn: "bg-yellow-100 text-yellow-800 border-yellow-300",
    chipOff: "bg-white text-slate-400 border-slate-200",
  },
  lost: {
    label: "Listing lost",
    color: "#DC2626",
    chipOn: "bg-red-100 text-red-800 border-red-300",
    chipOff: "bg-white text-slate-400 border-slate-200",
  },
};

// Lost (red) stays out of the UI for now — future revision gets its own map.
const STATUS_ORDER: PropertyMgmtStatus[] = ["active", "offboarding"];

const HDPM_OFFICE = { lat: 44.256798, lng: -121.184346 };

function houseMarkerEl(color: string, title: string, unitCount: number): HTMLElement {
  const el = document.createElement("div");
  el.title = title;
  const badge =
    unitCount > 1
      ? `<div style="
          position:absolute; top:-6px; right:-8px;
          min-width:15px; height:15px; padding:0 3px;
          background:white; border:1.5px solid ${color}; border-radius:8px;
          display:flex; align-items:center; justify-content:center;
          font:700 9px/1 system-ui, sans-serif; color:#1F2937;
          box-shadow:0 1px 2px rgba(0,0,0,0.3);
        ">${unitCount}</div>`
      : "";
  el.innerHTML = `
    <div style="position:relative; display:inline-block;">
      <svg width="26" height="26" viewBox="0 0 24 24" style="cursor:pointer;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4));display:block;">
        <path
          d="M12 2.1 1.5 11h2.6v10.5h5.4v-6.6h5v6.6h5.4V11h2.6L12 2.1z"
          fill="${color}" stroke="white" stroke-width="1.4" stroke-linejoin="round"
        />
      </svg>
      ${badge}
    </div>
  `;
  return el;
}

// ────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────

export function PropertyMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map());
  const didFitBounds = useRef(false);

  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [properties, setProperties] = useState<MapProperty[]>([]);
  const [statusTableReady, setStatusTableReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState<Record<PropertyMgmtStatus, boolean>>({
    active: true,
    offboarding: true,
    lost: true,
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showCitySummary, setShowCitySummary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

  // Load Google Maps script (same pattern as components/GoogleMap.tsx)
  useEffect(() => {
    if (!apiKey) {
      setError("Google Maps API key not configured");
      return;
    }
    if (window.google?.maps) {
      setScriptLoaded(true);
      return;
    }
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      existingScript.addEventListener("load", () => setScriptLoaded(true));
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => setScriptLoaded(true);
    script.onerror = () => setError("Failed to load Google Maps");
    document.head.appendChild(script);
  }, [apiKey]);

  // Load properties
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/properties/map");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load properties");
        if (cancelled) return;
        setProperties(data.properties || []);
        setStatusTableReady(Boolean(data.status_table_ready));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load properties");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Init map + markers
  useEffect(() => {
    if (!scriptLoaded || !mapRef.current || properties.length === 0) return;

    if (!mapInstance.current) {
      mapInstance.current = new google.maps.Map(mapRef.current, {
        center: HDPM_OFFICE,
        zoom: 11,
        mapId: "hdpm-property-map",
        disableDefaultUI: false,
        zoomControl: true,
        // Layer picker: Map (with Terrain) / Satellite (with Labels)
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        styles: [
          { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
        ],
      });
    }
    const map = mapInstance.current;

    // Rebuild markers from scratch (statuses may have changed)
    for (const marker of markersRef.current.values()) {
      marker.map = null;
    }
    markersRef.current = new Map();

    const bounds = new google.maps.LatLngBounds();
    for (const prop of properties) {
      if (prop.status === "lost") continue;
      const config = STATUS_CONFIG[prop.status];
      const title = `${prop.name || prop.address} — ${config.label}${
        prop.unit_count > 1 ? ` · ${prop.unit_count} units` : ""
      }`;
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: prop.lat, lng: prop.lng },
        title,
        content: houseMarkerEl(config.color, title, prop.unit_count),
      });
      marker.addListener("click", () => setSelectedKey(prop.key));
      markersRef.current.set(prop.key, marker);
      bounds.extend({ lat: prop.lat, lng: prop.lng });
    }
    if (!didFitBounds.current) {
      map.fitBounds(bounds, 40);
      didFitBounds.current = true;
    }
    // Markers were rebuilt for the full set; apply the current filters
    for (const prop of properties) {
      const marker = markersRef.current.get(prop.key);
      if (marker) marker.map = visible[prop.status] ? map : null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptLoaded, properties]);

  // Apply filter toggles without rebuilding markers
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    for (const prop of properties) {
      const marker = markersRef.current.get(prop.key);
      if (marker) marker.map = visible[prop.status] ? map : null;
    }
  }, [visible, properties]);

  const counts = useMemo(() => {
    const c: Record<PropertyMgmtStatus, { props: number; units: number }> = {
      active: { props: 0, units: 0 },
      offboarding: { props: 0, units: 0 },
      lost: { props: 0, units: 0 },
    };
    for (const p of properties) {
      c[p.status].props++;
      c[p.status].units += p.unit_count;
    }
    return c;
  }, [properties]);

  const selected = useMemo(
    () => properties.find((p) => p.key === selectedKey) || null,
    [properties, selectedKey]
  );

  // Per-city rollup for the ⓘ summary, excluding lost (not shown on the map)
  const citySummary = useMemo(() => {
    const byCity = new Map<
      string,
      { city: string; properties: number; units: number; leaving: number }
    >();
    for (const p of properties) {
      if (p.status === "lost") continue;
      const cityKey = p.city.trim().toLowerCase();
      let entry = byCity.get(cityKey);
      if (!entry) {
        entry = { city: p.city.trim(), properties: 0, units: 0, leaving: 0 };
        byCity.set(cityKey, entry);
      }
      entry.properties++;
      entry.units += p.unit_count;
      if (p.status === "offboarding") entry.leaving++;
    }
    return [...byCity.values()].sort((a, b) => b.units - a.units);
  }, [properties]);

  const setStatus = useCallback(
    async (prop: MapProperty, status: PropertyMgmtStatus) => {
      if (!prop.appfolio_property_id || prop.status === status) return;
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch("/api/properties/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appfolio_property_id: prop.appfolio_property_id, status }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to save status");
        setProperties((prev) =>
          prev.map((p) =>
            p.appfolio_property_id === prop.appfolio_property_id ? { ...p, status } : p
          )
        );
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Failed to save status");
      } finally {
        setSaving(false);
      }
    },
    []
  );

  if (error) {
    return (
      <div className="h-[70vh] rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {STATUS_ORDER.map((status) => {
          const config = STATUS_CONFIG[status];
          const on = visible[status];
          return (
            <button
              key={status}
              onClick={() => setVisible((v) => ({ ...v, [status]: !v[status] }))}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${
                on ? config.chipOn : config.chipOff
              }`}
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: on ? config.color : "#CBD5E1" }}
              />
              {config.label}
              <span
                className="tabular-nums"
                title={`${counts[status].props} properties / ${counts[status].units} units`}
              >
                {counts[status].props}/{counts[status].units}
              </span>
            </button>
          );
        })}
        {loading && <span className="text-sm text-slate-400">Loading properties…</span>}
        {!loading && !statusTableReady && (
          <span className="text-xs text-amber-600">
            Status table missing — apply migration 20260727 to enable yellow/red tagging
          </span>
        )}
        <button
          onClick={() => setShowCitySummary((v) => !v)}
          aria-label="Summary by city"
          title="Summary by city"
          className={`ml-auto w-7 h-7 rounded-full border flex items-center justify-center text-sm font-serif italic font-semibold transition-colors ${
            showCitySummary
              ? "bg-slate-700 border-slate-700 text-white"
              : "bg-white border-slate-300 text-slate-500 hover:bg-slate-100"
          }`}
        >
          i
        </button>
      </div>

      {/* City summary panel */}
      {showCitySummary && (
        <div className="absolute top-12 right-0 z-10 w-72 max-w-[calc(100%-1rem)] bg-white rounded-xl shadow-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-slate-800">By city</div>
            <button
              onClick={() => setShowCitySummary(false)}
              className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="text-left font-medium pb-1">City</th>
                <th className="text-right font-medium pb-1">Props</th>
                <th className="text-right font-medium pb-1">Units</th>
                <th className="text-right font-medium pb-1 text-yellow-600">Leaving</th>
              </tr>
            </thead>
            <tbody>
              {citySummary.map((row) => (
                <tr key={row.city} className="border-t border-slate-100">
                  <td className="py-1 text-slate-700">{row.city}</td>
                  <td className="py-1 text-right tabular-nums text-slate-700">
                    {row.properties}
                  </td>
                  <td className="py-1 text-right tabular-nums text-slate-700">{row.units}</td>
                  <td className="py-1 text-right tabular-nums text-yellow-700">
                    {row.leaving || ""}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 font-semibold text-slate-800">
                <td className="py-1">Total</td>
                <td className="py-1 text-right tabular-nums">
                  {citySummary.reduce((n, r) => n + r.properties, 0)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {citySummary.reduce((n, r) => n + r.units, 0)}
                </td>
                <td className="py-1 text-right tabular-nums text-yellow-700">
                  {citySummary.reduce((n, r) => n + r.leaving, 0) || ""}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Map */}
      <div ref={mapRef} className="h-[72vh] w-full rounded-xl overflow-hidden bg-slate-100" />

      {/* Selected property card */}
      {selected && (
        <div className="absolute bottom-4 left-4 w-80 max-w-[calc(100%-2rem)] bg-white rounded-xl shadow-lg border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold text-slate-800 text-sm">
                {selected.name || selected.address}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {selected.address}, {selected.city}
                {selected.unit_count > 1 ? ` · ${selected.unit_count} units` : ""}
              </div>
              {selected.management_end_date && (
                <div className="text-xs text-amber-700 mt-1">
                  Management ends {selected.management_end_date}
                  {selected.management_end_reason
                    ? ` — ${selected.management_end_reason}`
                    : ""}
                </div>
              )}
              {selected.appfolio_url && (
                <a
                  href={selected.appfolio_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                >
                  Open in AppFolio
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path d="M4 2h6v6M10 2 5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              )}
            </div>
            <button
              onClick={() => setSelectedKey(null)}
              className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="mt-3 space-y-1.5">
            {STATUS_ORDER.map((status) => {
              const config = STATUS_CONFIG[status];
              const isCurrent = selected.status === status;
              const disabled =
                saving || !statusTableReady || !selected.appfolio_property_id;
              return (
                <button
                  key={status}
                  disabled={disabled}
                  onClick={() => setStatus(selected, status)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm text-left transition-colors ${
                    isCurrent
                      ? "border-slate-400 bg-slate-50 font-medium text-slate-800"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  } ${disabled && !isCurrent ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ background: config.color }}
                  />
                  {config.label}
                  {isCurrent && <span className="ml-auto text-xs text-slate-400">current</span>}
                </button>
              );
            })}
          </div>

          {!selected.appfolio_property_id && (
            <div className="mt-2 text-xs text-amber-600">
              No AppFolio property id on this record — status can’t be saved.
            </div>
          )}
          {saveError && <div className="mt-2 text-xs text-red-600">{saveError}</div>}
        </div>
      )}
    </div>
  );
}

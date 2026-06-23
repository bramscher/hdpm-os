"use client";

import React, { useState, useCallback, useEffect } from "react";
import {
  Loader2,
  RefreshCw,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Home,
  Sparkles,
  RotateCcw,
  Code,
  ToggleLeft,
  ToggleRight,
  Save,
  History,
  Trash2,
  ImageIcon,
  Download,
  X,
  CheckCircle2,
  GripVertical,
  Search,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface VacantUnit {
  appfolio_unit_id: string;
  appfolio_property_id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  bedrooms: number;
  bathrooms: number;
  rent: number;
  sqft: number;
  available_date: string;
  unit_type: string;
  amenities: string[];
  marketing_description: string;
  ready_for_posting: boolean;
  status_reason: string;
}

interface SavedListing {
  id: string;
  appfolio_unit_id: string;
  address: string;
  city: string;
  state: string;
  zip: string | null;
  bedrooms: number;
  bathrooms: number | null;
  sqft: number | null;
  monthly_rent: number;
  listing_title: string;
  listing_body: string;
  rently_enabled: boolean;
  rently_url: string | null;
  created_by: string;
  created_at: string;
}

interface UnitPhoto {
  id: string;
  url: string;
  thumbnail_url: string;
  caption: string;
  is_primary: boolean;
}

type View = "list" | "editor" | "history";

export function CraigslistTool() {
  const [view, setView] = useState<View>("list");
  const [units, setUnits] = useState<VacantUnit[]>([]);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Per-unit Haven Codebox tour state (rently* names are legacy)
  const [rentlyToggles, setRentlyToggles] = useState<Record<string, boolean>>({});
  const [rentlyUrls, setRentlyUrls] = useState<Record<string, string>>({});

  // Editor state
  const [selectedUnit, setSelectedUnit] = useState<VacantUnit | null>(null);
  const [generating, setGenerating] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editorRentlyUrl, setEditorRentlyUrl] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Photos state
  const [photos, setPhotos] = useState<UnitPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [photoBlobs, setPhotoBlobs] = useState<Record<string, Blob>>({});

  // History state
  const [savedListings, setSavedListings] = useState<SavedListing[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Load cached vacancies on mount (instant)
  const loadCached = useCallback(async () => {
    try {
      const res = await fetch("/api/cached-vacancies");
      const data = await res.json();
      if (res.ok && data.units?.length > 0) {
        setUnits(data.units);
        setFetched(true);
      }
    } catch {
      // Cache miss is fine — user can pull fresh
    } finally {
      // Done probing the cache — safe to reveal either the unit list or the
      // "Pull from AppFolio" empty state without flashing the latter first.
      setInitializing(false);
    }
  }, []);

  // Sync: pull fresh from AppFolio, upsert cache, remove stale
  const fetchVacancies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cached-vacancies", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUnits(data.units || []);
      setFetched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch vacancies");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load cached data on mount
  useEffect(() => {
    loadCached();
  }, [loadCached]);

  const fetchPhotos = useCallback(async (propertyId: string, unitId: string) => {
    setPhotosLoading(true);
    setPhotos([]);
    setPhotoBlobs({});
    try {
      const params = new URLSearchParams({ property_id: propertyId, unit_id: unitId });
      const res = await fetch(`/api/appfolio-photos?${params}`);
      const data = await res.json();
      if (res.ok && data.photos?.length > 0) {
        setPhotos(data.photos);
        // Pre-fetch blobs via proxy for drag-and-drop
        const blobs: Record<string, Blob> = {};
        await Promise.all(
          data.photos.map(async (photo: UnitPhoto) => {
            try {
              const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(photo.url)}`;
              const imgRes = await fetch(proxyUrl);
              if (imgRes.ok) blobs[photo.id] = await imgRes.blob();
            } catch {
              // Non-critical — photo just won't be draggable
            }
          })
        );
        setPhotoBlobs(blobs);
      }
    } catch {
      // Photos are optional — fail silently
    } finally {
      setPhotosLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/saved-listings");
      const data = await res.json();
      if (res.ok) setSavedListings(data.listings || []);
    } catch {
      // Non-critical
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const handleGenerate = useCallback(
    async (unit: VacantUnit) => {
      const rentlyEnabled = rentlyToggles[unit.appfolio_unit_id] || false;
      const rentlyUrl = rentlyUrls[unit.appfolio_unit_id] || "";

      setSelectedUnit(unit);
      setEditorRentlyUrl(rentlyUrl);
      setView("editor");
      setGenerating(true);
      setTitle("");
      setBody("");
      setShowSource(false);
      setCopied(false);
      setSaved(false);
      setShowPhotos(false);
      setSelectedPhotos(new Set());

      // Fetch photos in parallel with generation
      fetchPhotos(unit.appfolio_property_id, unit.appfolio_unit_id);

      try {
        const res = await fetch("/api/generate-listing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            unit,
            rently_enabled: rentlyEnabled,
            rently_url: rentlyUrl,
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        setTitle(data.title || "");
        setBody(data.body || "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to format listing");
        setView("list");
      } finally {
        setGenerating(false);
      }
    },
    [rentlyToggles, rentlyUrls, fetchPhotos]
  );

  const handleSave = useCallback(async () => {
    if (!selectedUnit || !title || !body) return;

    setSaving(true);
    try {
      const rentlyEnabled = rentlyToggles[selectedUnit.appfolio_unit_id] || false;

      const res = await fetch("/api/saved-listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appfolio_unit_id: selectedUnit.appfolio_unit_id,
          address: selectedUnit.address,
          city: selectedUnit.city,
          state: selectedUnit.state,
          zip: selectedUnit.zip,
          bedrooms: selectedUnit.bedrooms,
          bathrooms: selectedUnit.bathrooms,
          sqft: selectedUnit.sqft,
          monthly_rent: selectedUnit.rent,
          unit_type: selectedUnit.unit_type,
          amenities: selectedUnit.amenities,
          available_date: selectedUnit.available_date,
          listing_title: title,
          listing_body: body,
          rently_enabled: rentlyEnabled,
          rently_url: editorRentlyUrl || null,
          created_by: "staff@highdesertpm.com",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save listing");
    } finally {
      setSaving(false);
    }
  }, [selectedUnit, title, body, editorRentlyUrl, rentlyToggles]);

  const handleDeleteSaved = useCallback(async (id: string) => {
    try {
      await fetch("/api/saved-listings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setSavedListings((prev) => prev.filter((l) => l.id !== id));
    } catch {
      // Non-critical
    }
  }, []);

  const handleLoadSaved = useCallback((listing: SavedListing) => {
    setTitle(listing.listing_title);
    setBody(listing.listing_body);
    setEditorRentlyUrl(listing.rently_url || "");
    setSelectedUnit({
      appfolio_unit_id: listing.appfolio_unit_id,
      appfolio_property_id: "",
      address: listing.address,
      city: listing.city,
      state: listing.state,
      zip: listing.zip || "",
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms || 0,
      rent: listing.monthly_rent,
      sqft: listing.sqft || 0,
      available_date: "",
      unit_type: "",
      amenities: [],
      marketing_description: "",
      ready_for_posting: true,
      status_reason: "",
    });
    setView("editor");
    setSaved(false);
    setCopied(false);
    setShowSource(false);
  }, []);

  const handleCopy = useCallback(async () => {
    const fullText = `${title}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = fullText;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [title, body]);

  const [zipping, setZipping] = useState(false);

  const handleDownloadZip = useCallback(async () => {
    const photosToDownload = selectedPhotos.size > 0
      ? photos.filter((p) => selectedPhotos.has(p.id))
      : photos;

    if (photosToDownload.length === 0) return;

    setZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const folderName = selectedUnit
        ? selectedUnit.address.replace(/[^a-zA-Z0-9 ]/g, "").trim()
        : "photos";

      for (let i = 0; i < photosToDownload.length; i++) {
        const photo = photosToDownload[i];
        const blob = photoBlobs[photo.id] || await fetch(`/api/proxy-image?url=${encodeURIComponent(photo.url)}`).then(r => r.blob());
        const ext = photo.url.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || "jpg";
        zip.file(`${folderName}/${String(i + 1).padStart(2, "0")}.${ext}`, blob);
      }

      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(content);
      link.download = `${folderName}-photos.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (err) {
      console.error("Failed to create zip:", err);
    } finally {
      setZipping(false);
    }
  }, [photos, selectedPhotos, selectedUnit, photoBlobs]);

  const handlePhotoDragStart = useCallback(
    (e: React.DragEvent, photoId: string, index: number) => {
      const photo = photos.find((p) => p.id === photoId);
      const blob = photoBlobs[photoId];
      if (!photo || !blob) return;

      const fileName = `photo-${String(index + 1).padStart(2, "0")}.jpg`;
      const mimeType = blob.type || "image/jpeg";
      const file = new File([blob], fileName, { type: mimeType });
      e.dataTransfer.items.add(file);

      // Chrome/Edge DownloadURL lets us drag files OUT of the browser to the
      // desktop (or Finder, or any native app). Using the proxy-image endpoint
      // — a real HTTPS URL — is more reliable than blob: URLs, which Chrome
      // sometimes fails to fetch mid-drag. Safari ignores DownloadURL entirely.
      const proxyUrl = `${window.location.origin}/api/proxy-image?url=${encodeURIComponent(photo.url)}`;
      e.dataTransfer.setData(
        "DownloadURL",
        `${mimeType}:${fileName}:${proxyUrl}`
      );
      e.dataTransfer.effectAllowed = "copy";
    },
    [photos, photoBlobs]
  );

  const handleDragAllStart = useCallback(
    (e: React.DragEvent) => {
      const photosToUse = selectedPhotos.size > 0
        ? photos.filter((p) => selectedPhotos.has(p.id))
        : photos;

      for (let i = 0; i < photosToUse.length; i++) {
        const blob = photoBlobs[photosToUse[i].id];
        if (!blob) continue;
        const fileName = `photo-${String(i + 1).padStart(2, "0")}.jpg`;
        const file = new File([blob], fileName, { type: blob.type || "image/jpeg" });
        e.dataTransfer.items.add(file);
      }

      // DownloadURL only supports a single file, so for the "drag all" handle
      // we use the first photo as the representative for browser→desktop drags.
      // Users who want all photos should use the ZIP download instead.
      const firstPhoto = photosToUse[0];
      const firstBlob = firstPhoto && photoBlobs[firstPhoto.id];
      if (firstPhoto && firstBlob) {
        const mimeType = firstBlob.type || "image/jpeg";
        const proxyUrl = `${window.location.origin}/api/proxy-image?url=${encodeURIComponent(firstPhoto.url)}`;
        e.dataTransfer.setData(
          "DownloadURL",
          `${mimeType}:photo-01.jpg:${proxyUrl}`
        );
      }
      e.dataTransfer.effectAllowed = "copy";
    },
    [photos, selectedPhotos, photoBlobs]
  );

  const togglePhotoSelection = useCallback((photoId: string) => {
    setSelectedPhotos((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  const handleStartOver = useCallback(() => {
    setView("list");
    setSelectedUnit(null);
    setTitle("");
    setBody("");
    setError(null);
    setCopied(false);
    setSaved(false);
    setShowSource(false);
    setPhotos([]);
    setShowPhotos(false);
    setSelectedPhotos(new Set());
    setPhotoBlobs({});
  }, []);

  const toggleRently = useCallback((unitId: string) => {
    setRentlyToggles((prev) => ({ ...prev, [unitId]: !prev[unitId] }));
  }, []);

  const setRentlyUrl = useCallback((unitId: string, url: string) => {
    setRentlyUrls((prev) => ({ ...prev, [unitId]: url }));
  }, []);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "Contact for date";
    try {
      const d = new Date(dateStr + "T00:00:00");
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    } catch {
      return dateStr;
    }
  };

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    } catch {
      return ts;
    }
  };

  // ── History View ──
  if (view === "history") {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-charcoal-900">
              Saved Listings
            </h1>
            <p className="text-sm text-charcoal-500 mt-1">
              Previously formatted Craigslist listings
            </p>
          </div>
          <Button
            onClick={handleStartOver}
            variant="outline"
            size="sm"
            className="text-charcoal-600"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Back to Vacancies
          </Button>
        </div>

        {historyLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass rounded-xl p-5 animate-pulse">
                <div className="h-5 bg-charcoal-200 rounded w-2/3 mb-3" />
                <div className="h-4 bg-charcoal-100 rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : savedListings.length === 0 ? (
          <div className="glass rounded-xl p-10 text-center">
            <History className="h-10 w-10 text-charcoal-300 mx-auto mb-3" />
            <p className="text-charcoal-500 text-sm">
              No saved listings yet
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {savedListings.map((listing) => (
              <div
                key={listing.id}
                className="glass glass-shine rounded-xl p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-charcoal-900 truncate">
                      {listing.listing_title}
                    </h3>
                    <p className="text-xs text-charcoal-500 mt-0.5">
                      {listing.address}, {listing.city} &middot;{" "}
                      ${listing.monthly_rent.toLocaleString()}/mo &middot;{" "}
                      {listing.bedrooms}BR/{listing.bathrooms}BA
                    </p>
                    <p className="text-2xs text-charcoal-400 mt-1">
                      Saved {formatTimestamp(listing.created_at)} by{" "}
                      {listing.created_by}
                    </p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <Button
                      onClick={() => handleLoadSaved(listing)}
                      size="sm"
                      className="bg-terra-600 hover:bg-terra-700 text-white"
                    >
                      Open
                    </Button>
                    <Button
                      onClick={() => handleDeleteSaved(listing.id)}
                      size="sm"
                      variant="outline"
                      className="text-red-500 hover:text-red-700 hover:border-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── List View ──
  if (view === "list") {
    const trimmedQuery = searchQuery.trim().toLowerCase();
    const isSearching = trimmedQuery.length > 0;
    const readyUnits = units.filter((u) => u.ready_for_posting);
    const displayedUnits = isSearching
      ? units.filter((u) => {
          const haystack = `${u.address} ${u.city} ${u.zip}`.toLowerCase();
          return haystack.includes(trimmedQuery);
        })
      : readyUnits;
    const showSyncFallback = isSearching && displayedUnits.length === 0;

    return (
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-charcoal-900">
              Craigslist Listing Generator
            </h1>
            <p className="text-sm text-charcoal-500 mt-1">
              Search any property in AppFolio, format marketing descriptions for Craigslist
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setView("history");
                fetchHistory();
              }}
              variant="outline"
              size="sm"
              className="text-charcoal-600"
            >
              <History className="h-4 w-4 mr-1.5" />
              Saved
            </Button>
          </div>
        </div>

        {/* Search box */}
        <div className="glass rounded-xl p-3 mb-4">
          <div className="relative flex items-center">
            <Search className="h-4 w-4 text-charcoal-400 absolute left-3 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search any property by address or city…"
              className="pl-9 pr-9 bg-white/70 border-0 h-10 text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 text-charcoal-400 hover:text-charcoal-600"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {isSearching && (
            <p className="text-2xs text-charcoal-400 mt-2 px-1">
              Showing {displayedUnits.length} of {units.length} total units
            </p>
          )}
          {!isSearching && fetched && (
            <p className="text-2xs text-charcoal-400 mt-2 px-1">
              Showing {readyUnits.length} unit{readyUnits.length === 1 ? "" : "s"} ready to post.
              Search to find any property in AppFolio.
            </p>
          )}
        </div>

        {error && (
          <div className="p-4 bg-red-50/80 border border-red-200/50 rounded-xl text-red-700 text-sm mb-4">
            {error}
          </div>
        )}

        {/* Loading skeleton — covers both the manual sync and the initial
            cache probe so the "Pull from AppFolio" panel never flashes first */}
        {(loading || initializing) && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass rounded-xl p-5 animate-pulse">
                <div className="h-5 bg-charcoal-200 rounded w-2/3 mb-3" />
                <div className="h-4 bg-charcoal-100 rounded w-1/3" />
              </div>
            ))}
          </div>
        )}

        {/* Initial empty state — no sync ever done */}
        {!fetched && !loading && !initializing && (
          <div className="glass rounded-xl p-10 text-center">
            <Home className="h-10 w-10 text-charcoal-300 mx-auto mb-3" />
            <p className="text-charcoal-500 text-sm mb-4">
              No units loaded yet — pull the full property list from AppFolio
            </p>
            <Button
              onClick={fetchVacancies}
              disabled={loading}
              className="bg-terra-600 hover:bg-terra-700 text-white"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Pull from AppFolio
            </Button>
          </div>
        )}

        {/* No ready units and no search — show friendly empty state */}
        {fetched && !loading && !isSearching && readyUnits.length === 0 && (
          <div className="glass rounded-xl p-10 text-center">
            <Home className="h-10 w-10 text-charcoal-300 mx-auto mb-3" />
            <p className="text-charcoal-500 text-sm">
              No units are currently ready to post. Search above to find any property.
            </p>
          </div>
        )}

        {/* Search returned no matches → offer sync */}
        {showSyncFallback && (
          <div className="glass rounded-xl p-10 text-center">
            <AlertCircle className="h-10 w-10 text-charcoal-300 mx-auto mb-3" />
            <p className="text-charcoal-600 text-sm mb-1">
              No properties match &quot;{searchQuery}&quot;
            </p>
            <p className="text-xs text-charcoal-400 mb-4">
              If it was recently added in AppFolio, re-sync to refresh the cache.
            </p>
            <Button
              onClick={fetchVacancies}
              disabled={loading}
              className="bg-terra-600 hover:bg-terra-700 text-white"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Sync from AppFolio
            </Button>
          </div>
        )}

        {/* Unit cards */}
        {!loading && displayedUnits.length > 0 && (
          <div className="space-y-3">
            {displayedUnits.map((unit) => {
              const rentlyOn = rentlyToggles[unit.appfolio_unit_id] || false;
              const isReady = unit.ready_for_posting;
              return (
                <div
                  key={unit.appfolio_unit_id}
                  className={cn(
                    "glass glass-shine rounded-xl overflow-hidden",
                    !isReady && "opacity-80"
                  )}
                >
                  <div className="p-5">
                    {/* Top row: address + generate button */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-bold text-charcoal-900 truncate">
                            {unit.address}
                          </h3>
                          {isReady ? (
                            <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
                              <CheckCircle2 className="h-3 w-3" />
                              Ready to post
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-semibold">
                              <AlertCircle className="h-3 w-3" />
                              {unit.status_reason || "Not ready"}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-charcoal-500 mt-0.5">
                          {unit.city}, {unit.state} {unit.zip}
                        </p>
                      </div>
                      <Button
                        onClick={() => handleGenerate(unit)}
                        disabled={!isReady}
                        size="sm"
                        className="bg-terra-600 hover:bg-terra-700 text-white flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={isReady ? undefined : "Unit is not posted to website in AppFolio"}
                      >
                        <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                        Format for HDPM Craigslist
                      </Button>
                    </div>

                    {/* Stats row */}
                    <div className="flex flex-wrap items-center gap-3 mt-3">
                      {unit.rent > 0 && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-terra-50 text-terra-700 text-xs font-semibold">
                          ${unit.rent.toLocaleString()}/mo
                        </span>
                      )}
                      <span className="text-xs text-charcoal-600">
                        {unit.bedrooms}BR / {unit.bathrooms}BA
                      </span>
                      {unit.sqft > 0 && (
                        <span className="text-xs text-charcoal-500">
                          {unit.sqft.toLocaleString()} sqft
                        </span>
                      )}
                      <span className="text-xs text-charcoal-500">
                        {unit.unit_type}
                      </span>
                      {unit.available_date && (
                        <span className="text-xs text-charcoal-400">
                          Avail: {formatDate(unit.available_date)}
                        </span>
                      )}
                    </div>

                    {/* Amenities preview */}
                    {unit.amenities.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {unit.amenities.slice(0, 6).map((a) => (
                          <span
                            key={a}
                            className="text-2xs px-2 py-0.5 rounded-full bg-sand-100 text-charcoal-600"
                          >
                            {a}
                          </span>
                        ))}
                        {unit.amenities.length > 6 && (
                          <span className="text-2xs px-2 py-0.5 rounded-full bg-sand-100 text-charcoal-400">
                            +{unit.amenities.length - 6} more
                          </span>
                        )}
                      </div>
                    )}

                    {/* Haven Codebox tour controls — only for units you can
                        actually post. Internal field names (rently*) are legacy
                        from the previous self-tour vendor. */}
                    {isReady && (
                      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-charcoal-100">
                        <button
                          type="button"
                          onClick={() => toggleRently(unit.appfolio_unit_id)}
                          className="flex items-center gap-1.5 text-xs text-charcoal-600 hover:text-charcoal-800 transition-colors"
                        >
                          {rentlyOn ? (
                            <ToggleRight className="h-5 w-5 text-terra-600" />
                          ) : (
                            <ToggleLeft className="h-5 w-5 text-charcoal-400" />
                          )}
                          Haven Codebox Tours
                        </button>

                        {rentlyOn && (
                          <Input
                            value={rentlyUrls[unit.appfolio_unit_id] || ""}
                            onChange={(e) =>
                              setRentlyUrl(unit.appfolio_unit_id, e.target.value)
                            }
                            placeholder="Haven Codebox tour URL"
                            className="flex-1 h-8 text-xs bg-white/70"
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Subtle sync button — always available when data is loaded */}
        {fetched && !loading && !showSyncFallback && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={fetchVacancies}
              className="text-2xs text-charcoal-400 hover:text-charcoal-600 transition-colors flex items-center gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              Re-sync from AppFolio
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Editor View ──
  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-charcoal-900">
            {generating ? "Formatting Listing..." : title || "Edit Listing"}
          </h1>
          {selectedUnit && (
            <p className="text-sm text-charcoal-500 mt-0.5">
              {selectedUnit.address}, {selectedUnit.city}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleStartOver}
            variant="outline"
            size="sm"
            className="text-charcoal-600"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Back
          </Button>
          <Button
            onClick={handleSave}
            disabled={generating || !body || saving}
            size="sm"
            variant="outline"
            className={cn(
              saved
                ? "text-green-600 border-green-300"
                : "text-charcoal-600"
            )}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : saved ? (
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1.5" />
            )}
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50/80 border border-red-200/50 rounded-xl text-red-700 text-sm mb-4">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-700"
          >
            <X className="h-3.5 w-3.5 inline" />
          </button>
        </div>
      )}

      {generating ? (
        <div className="glass rounded-xl p-10 text-center">
          <Loader2 className="h-8 w-8 text-terra-600 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-charcoal-600">Formatting listing...</p>
          <p className="text-xs text-charcoal-400 mt-1">
            This usually takes 5-10 seconds
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* ── Listing Preview (default view) ── */}
          <div className="glass rounded-xl overflow-hidden">
            <div className="bg-white rounded-xl p-6 border border-charcoal-100">
              <h2 className="text-lg font-bold text-charcoal-900 mb-4">
                {title}
              </h2>
              <div
                className="text-sm text-charcoal-700 leading-relaxed [&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_li]:mb-1 [&_table]:w-full [&_table]:my-3 [&_td]:p-2 [&_td]:text-center [&_hr]:my-4 [&_hr]:border-charcoal-200 [&_blockquote]:border-l-4 [&_blockquote]:border-charcoal-200 [&_blockquote]:pl-4 [&_blockquote]:italic [&_a]:text-terra-600 [&_a]:underline"
                dangerouslySetInnerHTML={{ __html: body }}
              />
            </div>
          </div>

          {/* ── Copy to Craigslist action bar ── */}
          <div className="glass rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-charcoal-800">
                  Ready to post
                </p>
                <p className="text-xs text-charcoal-400 mt-0.5">
                  Copy the HTML below and paste into Craigslist&apos;s posting body
                </p>
              </div>
              <Button
                onClick={handleCopy}
                disabled={!body}
                className={cn(
                  "text-white",
                  copied
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-terra-600 hover:bg-terra-700"
                )}
              >
                {copied ? (
                  <Check className="h-4 w-4 mr-2" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                {copied ? "Copied!" : "Copy HTML to Clipboard"}
              </Button>
            </div>
          </div>

          {/* ── Craigslist posting reminder ── */}
          <div className="glass rounded-xl px-5 py-3.5">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-charcoal-700">Craigslist Posting Reminder</p>
                <p className="text-xs text-charcoal-500 mt-1">
                  To enable the <b>&quot;call now&quot;</b> button on your listing, enter Leesa&apos;s number <b>(541) 406-6409</b> in the <b>phone</b> field on the Craigslist posting form and check <b>&quot;show my phone number&quot;</b>, <b>&quot;calls ok&quot;</b>, and <b>&quot;text ok&quot;</b>.
                </p>
              </div>
            </div>
          </div>

          {/* ── Photos for Craigslist upload ── */}
          <div className="glass rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowPhotos(!showPhotos)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-white/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-charcoal-500" />
                <span className="text-sm font-semibold text-charcoal-700">
                  Photos for Craigslist
                </span>
                {photos.length > 0 && (
                  <span className="text-2xs px-1.5 py-0.5 rounded-full bg-terra-50 text-terra-600 font-medium">
                    {photos.length}
                  </span>
                )}
                {photosLoading && (
                  <Loader2 className="h-3.5 w-3.5 text-charcoal-400 animate-spin" />
                )}
              </div>
              {showPhotos ? (
                <ChevronUp className="h-4 w-4 text-charcoal-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-charcoal-400" />
              )}
            </button>

            {showPhotos && (
              <div className="px-5 pb-5 border-t border-white/30 pt-4">
                {photosLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-6 w-6 text-charcoal-400 animate-spin" />
                  </div>
                ) : photos.length === 0 ? (
                  <div className="text-center py-6">
                    <ImageIcon className="h-8 w-8 text-charcoal-300 mx-auto mb-2" />
                    <p className="text-xs text-charcoal-500">
                      No photos available from AppFolio for this unit
                    </p>
                    <p className="text-2xs text-charcoal-400 mt-1">
                      Upload photos directly to Craigslist when posting
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="bg-sand-50 rounded-lg p-3 mb-3">
                      <p className="text-xs text-charcoal-600">
                        {Object.keys(photoBlobs).length > 0 ? (
                          <>
                            <b>Drag to Craigslist:</b> Drag individual photos or use the &quot;Drag All&quot; handle below directly onto Craigslist&apos;s image uploader. You can also download as ZIP.
                          </>
                        ) : (
                          <>
                            <b>Loading photos for drag &amp; drop...</b> You can also download as ZIP below.
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs text-charcoal-500">
                        {selectedPhotos.size > 0
                          ? `${selectedPhotos.size} of ${photos.length} selected`
                          : `${photos.length} photos — click to select, drag to Craigslist`}
                      </p>
                      <div className="flex gap-1.5">
                        {Object.keys(photoBlobs).length > 0 && (
                          <div
                            draggable
                            onDragStart={handleDragAllStart}
                            className="flex items-center gap-1 px-2.5 h-7 rounded-md bg-terra-600 text-white text-xs font-medium cursor-grab active:cursor-grabbing select-none"
                          >
                            <GripVertical className="h-3 w-3" />
                            {selectedPhotos.size > 0
                              ? `Drag ${selectedPhotos.size} Photos`
                              : "Drag All Photos"}
                          </div>
                        )}
                        <Button
                          onClick={handleDownloadZip}
                          size="sm"
                          disabled={zipping}
                          variant="outline"
                          className="text-charcoal-600 h-7 text-xs"
                        >
                          {zipping ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3 mr-1" />
                          )}
                          {zipping ? "Zipping..." : "Download ZIP"}
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {photos.map((photo, idx) => (
                        <div
                          key={photo.id}
                          draggable={!!photoBlobs[photo.id]}
                          onDragStart={(e) => handlePhotoDragStart(e, photo.id, idx)}
                          onClick={() => togglePhotoSelection(photo.id)}
                          className={cn(
                            "relative aspect-[4/3] rounded-lg overflow-hidden border-2 transition-all",
                            photoBlobs[photo.id] ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                            selectedPhotos.has(photo.id)
                              ? "border-terra-500 ring-2 ring-terra-500/30"
                              : "border-transparent hover:border-charcoal-200"
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photoBlobs[photo.id] ? URL.createObjectURL(photoBlobs[photo.id]) : photo.thumbnail_url}
                            alt={photo.caption || "Property photo"}
                            className="w-full h-full object-cover pointer-events-none"
                            draggable={false}
                          />
                          {selectedPhotos.has(photo.id) && (
                            <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-terra-500 flex items-center justify-center">
                              <Check className="h-3 w-3 text-white" />
                            </div>
                          )}
                          {photo.is_primary && (
                            <span className="absolute bottom-1 left-1 text-2xs px-1.5 py-0.5 rounded bg-black/60 text-white">
                              Primary
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Edit HTML Source (collapsible) ── */}
          <div className="glass rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowSource(!showSource)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-white/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Code className="h-4 w-4 text-charcoal-500" />
                <span className="text-sm font-semibold text-charcoal-700">
                  Edit HTML Source
                </span>
              </div>
              {showSource ? (
                <ChevronUp className="h-4 w-4 text-charcoal-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-charcoal-400" />
              )}
            </button>

            {showSource && (
              <div className="px-5 pb-5 border-t border-white/30 pt-4 space-y-3">
                {/* Title */}
                <div>
                  <label className="block text-[10px] font-semibold text-charcoal-400 uppercase tracking-widest mb-1.5">
                    Post Title
                  </label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="bg-white/70 text-sm font-medium"
                  />
                </div>

                {/* Haven Codebox Tour URL */}
                {selectedUnit && rentlyToggles[selectedUnit.appfolio_unit_id] && (
                  <div>
                    <label className="block text-[10px] font-semibold text-charcoal-400 uppercase tracking-widest mb-1.5">
                      Haven Codebox Tour URL
                    </label>
                    <Input
                      value={editorRentlyUrl}
                      onChange={(e) => setEditorRentlyUrl(e.target.value)}
                      placeholder="Haven Codebox tour URL"
                      className="bg-white/70 text-sm"
                    />
                    <p className="text-2xs text-charcoal-400 mt-1">
                      Update the URL here, then re-format or edit the body text manually
                    </p>
                  </div>
                )}

                {/* HTML Body */}
                <div>
                  <label className="block text-[10px] font-semibold text-charcoal-400 uppercase tracking-widest mb-1.5">
                    Listing Body (HTML)
                  </label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={24}
                    className="w-full rounded-xl border border-input bg-white/70 backdrop-blur-sm px-4 py-3 text-sm font-mono leading-relaxed ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-600/30 focus-visible:ring-offset-2 resize-y"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

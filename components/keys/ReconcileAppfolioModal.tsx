"use client";

import React, { useRef, useState } from "react";
import { FileSpreadsheet, Loader2, CheckCircle2, CloudDownload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ModalShell } from "./ModalShell";
import type { KeyReconcileCommitResult, KeyReconcilePreview } from "@/types/keys";

/**
 * Reconcile the AppFolio "Keys Detail" report export into the keys module.
 * Upload → per-row preview (joined via Unit ID) → commit replaces the snapshot.
 */
export function ReconcileAppfolioModal({
  onClose,
  onCommitted,
}: {
  onClose: () => void;
  onCommitted: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<KeyReconcilePreview | null>(null);
  const [result, setResult] = useState<KeyReconcileCommitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where the preview rows came from — commit must use the same source.
  const [source, setSource] = useState<"csv" | "appfolio">("csv");

  async function send(mode: "validate" | "commit", src: "csv" | "appfolio" = source) {
    if (src === "csv" && !file) return;
    setBusy(true);
    setError(null);
    setSource(src);
    try {
      const form = new FormData();
      if (src === "appfolio") {
        form.set("source", "appfolio");
      } else if (file) {
        form.set("file", file);
      }
      form.set("mode", mode);
      const res = await fetch("/api/keys/reconcile", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reconcile failed");
      if (mode === "validate") {
        setPreview(data);
      } else {
        setResult(data);
        onCommitted();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reconcile failed");
    } finally {
      setBusy(false);
    }
  }

  function pickFile(f: File | null) {
    setFile(f);
    setSource("csv");
    setPreview(null);
    setResult(null);
    setError(null);
  }

  return (
    <ModalShell title="Reconcile AppFolio key checkouts" onClose={onClose} busy={busy} wide>
      <div className="space-y-4 text-sm text-charcoal-700">
        {result ? (
          <div className="flex items-start gap-3 bg-terra-50 border border-terra-200 rounded-xl p-4">
            <CheckCircle2 className="w-5 h-5 text-terra-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-charcoal-900">Snapshot updated</p>
              <p className="text-xs text-charcoal-500 mt-1">
                Stored {result.rows_stored} checkout row{result.rows_stored !== 1 ? "s" : ""} across{" "}
                {result.units_covered} units — {result.keys_covered} keys now show AppFolio holder info.
                {result.skipped_missing_unit_id > 0 && (
                  <> {result.skipped_missing_unit_id} rows had no Unit ID and were skipped.</>
                )}
              </p>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => send("validate", "appfolio")}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 border border-terra-300 bg-terra-50/60 hover:bg-terra-50 rounded-xl p-4 text-sm font-medium text-charcoal-900 transition-colors"
            >
              {busy && source === "appfolio" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CloudDownload className="w-4 h-4 text-terra-600" />
              )}
              Fetch live from AppFolio (no CSV needed)
            </button>

            <p className="text-center text-[10px] uppercase tracking-wide text-charcoal-400">
              or upload the Keys Detail CSV export
            </p>

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                "w-full border-2 border-dashed rounded-xl p-6 text-center transition-colors",
                file ? "border-terra-300 bg-terra-50/50" : "border-sand-300 hover:border-terra-300"
              )}
            >
              <FileSpreadsheet className="w-6 h-6 mx-auto text-charcoal-400 mb-2" />
              {file ? (
                <span className="text-sm font-medium text-charcoal-900">{file.name}</span>
              ) : (
                <span className="text-sm text-charcoal-500">Click to choose the Keys Detail CSV</span>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            {preview && (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: "Rows", value: preview.total_rows, tone: "text-charcoal-900" },
                    { label: "Matched keys", value: preview.matched, tone: "text-terra-700" },
                    { label: "No key on file", value: preview.no_key, tone: "text-amber-600" },
                    { label: "No Unit ID", value: preview.missing_unit_id, tone: "text-red-600" },
                  ].map((s) => (
                    <div key={s.label} className="bg-sand-50 rounded-lg py-2">
                      <p className={cn("text-lg font-bold", s.tone)}>{s.value}</p>
                      <p className="text-[10px] text-charcoal-400 uppercase tracking-wide">{s.label}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-charcoal-500">
                  Covers {preview.units_covered} units · {preview.keys_covered} keys will show holder info.
                  {preview.missing_unit_id > 0 && (
                    <span className="text-red-600">
                      {" "}
                      Rows without a Unit ID are skipped — re-export with the Unit ID column enabled to
                      include them.
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-charcoal-400">
                  Committing replaces the previous AppFolio snapshot entirely.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
          {result ? "Close" : "Cancel"}
        </Button>
        {!result && !preview && (
          <Button size="sm" onClick={() => send("validate")} disabled={!file || busy}>
            {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Preview
          </Button>
        )}
        {!result && preview && (
          <Button size="sm" onClick={() => send("commit")} disabled={busy || preview.total_rows === 0}>
            {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Commit snapshot
          </Button>
        )}
      </div>
    </ModalShell>
  );
}

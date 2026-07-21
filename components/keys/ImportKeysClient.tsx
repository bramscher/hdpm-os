"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Upload, FileSpreadsheet, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { KeyImportCommitResult, KeyImportPreview } from "@/types/keys";

const CLASS_STYLES: Record<string, string> = {
  matched: "bg-green-50 text-green-700",
  unmatched: "bg-amber-50 text-amber-700",
  open: "bg-sand-100 text-charcoal-500",
  error: "bg-red-50 text-red-600",
};

export function ImportKeysClient() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<KeyImportPreview | null>(null);
  const [result, setResult] = useState<KeyImportCommitResult | null>(null);
  const [busy, setBusy] = useState<"validate" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterClass, setFilterClass] = useState<string | null>(null);

  async function run(mode: "validate" | "commit") {
    if (!file) return;
    setBusy(mode);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("mode", mode);
      const res = await fetch("/api/keys/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${mode} failed`);
      if (mode === "validate") setPreview(data);
      else setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${mode} failed`);
    } finally {
      setBusy(null);
    }
  }

  const visibleRows = preview
    ? filterClass
      ? preview.rows.filter((r) => r.classification === filterClass)
      : preview.rows
    : [];

  if (result) {
    return (
      <div className="bg-white rounded-xl border border-sand-200 shadow-card p-8 text-center max-w-lg mx-auto">
        <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-charcoal-900 mb-2">Import complete</h2>
        <p className="text-sm text-charcoal-500 mb-6">
          {result.assignments_created} key assignments created · {result.open_slots} open numbers
          {result.slots_created > 0 && ` · ${result.slots_created} new slots added`}
        </p>
        <p className="text-xs text-charcoal-400 mb-6">
          Next: run a sync to pull current tenants, owners, and vacancy from AppFolio.
        </p>
        <div className="flex justify-center gap-2">
          <Button
            onClick={async () => {
              await fetch("/api/sync/keys", { method: "POST" });
              router.push("/keys");
            }}
          >
            Run first sync
          </Button>
          <Button variant="outline" onClick={() => router.push("/keys")}>
            Go to Key Manager
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/keys"
          className="inline-flex items-center gap-1 text-xs font-medium text-charcoal-400 hover:text-charcoal-700 mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Key Manager
        </Link>
        <h1 className="text-xl font-bold text-charcoal-900 tracking-tight">Import master key list</h1>
        <p className="text-sm text-charcoal-400 mt-1">
          One-time seed from the key list spreadsheet (key #, address, owner, date). Rows are
          matched to AppFolio units by address; unmatched rows import as unlinked and can be
          linked later.
        </p>
      </div>

      {/* Upload */}
      <div className="bg-white rounded-xl border border-sand-200 shadow-card p-6">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-sand-300 hover:border-terra-400 cursor-pointer transition-colors">
            <FileSpreadsheet className="w-4 h-4 text-charcoal-400" />
            <span className="text-sm text-charcoal-600">
              {file ? file.name : "Choose .xlsx file…"}
            </span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setError(null);
              }}
            />
          </label>
          <Button onClick={() => run("validate")} disabled={!file || busy !== null}>
            {busy === "validate" ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-1.5" />
            )}
            {busy === "validate" ? "Checking…" : "Preview import"}
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div className="bg-white rounded-xl border border-sand-200 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-sand-200">
            <div className="flex flex-wrap gap-2">
              {[
                { key: null, label: `All (${preview.total_rows})` },
                { key: "matched", label: `Matched (${preview.matched})` },
                { key: "unmatched", label: `Unmatched (${preview.unmatched})` },
                { key: "open", label: `Open (${preview.open})` },
                { key: "error", label: `Errors (${preview.errors})` },
              ].map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => setFilterClass(chip.key)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors",
                    filterClass === chip.key
                      ? "bg-charcoal-900 text-white"
                      : "bg-sand-100 text-charcoal-500 hover:bg-sand-200"
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <Button onClick={() => run("commit")} disabled={busy !== null}>
              {busy === "commit" ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : null}
              {busy === "commit" ? "Importing…" : "Commit import"}
            </Button>
          </div>
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-sand-200 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left w-20">Key #</th>
                  <th className="px-4 py-2.5 text-left">Spreadsheet address</th>
                  <th className="px-4 py-2.5 text-left">Owner</th>
                  <th className="px-4 py-2.5 text-left">Date</th>
                  <th className="px-4 py-2.5 text-left">Result</th>
                  <th className="px-4 py-2.5 text-left">Matched unit</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.row_number} className="border-b border-sand-100 last:border-0">
                    <td className="px-4 py-2 font-semibold text-charcoal-900">
                      {r.key_number ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-charcoal-700">{r.raw_address || "—"}</td>
                    <td className="px-4 py-2 text-charcoal-500">{r.owner || "—"}</td>
                    <td className="px-4 py-2 text-charcoal-500 whitespace-nowrap">
                      {r.date_used ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          "inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold",
                          CLASS_STYLES[r.classification]
                        )}
                        title={r.issues.join("; ") || undefined}
                      >
                        {r.classification}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-charcoal-500">{r.matched_address ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

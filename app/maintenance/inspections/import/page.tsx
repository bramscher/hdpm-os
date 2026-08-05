"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Copy,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────

interface ParsedColumn {
  index: number;
  header: string;
}

interface MappingTarget {
  key: string;
  label: string;
  required: boolean;
}

interface PreviewRow {
  row_number: number;
  data: Record<string, string>;
}

interface ValidationRow {
  row_number: number;
  address: string;
  city: string;
  unit: string;
  type: string;
  due_date: string;
  status: "valid" | "warning" | "error" | "duplicate";
  issues: string[];
}

interface ValidationResult {
  valid: number;
  warnings: number;
  errors: number;
  duplicates: number;
  rows: ValidationRow[];
}

const MAPPING_TARGETS: MappingTarget[] = [
  { key: "address_1", label: "Property Address", required: true },
  { key: "city", label: "City", required: true },
  { key: "unit_name", label: "Unit Name", required: false },
  { key: "resident_name", label: "Tenant Name", required: false },
  { key: "last_inspection_date", label: "Last Inspection Date", required: false },
  { key: "inspection_type", label: "Inspection Type", required: false },
  { key: "due_date", label: "Due Date", required: false },
  { key: "owner_name", label: "Owner Name", required: false },
  { key: "priority", label: "Priority", required: false },
  { key: "notes", label: "Notes", required: false },
  { key: "zip", label: "Zip", required: false },
];

// ────────────────────────────────────────────────
// Auto-mapping logic
// ────────────────────────────────────────────────

function autoMap(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());

  const rules: { pattern: string; target: string }[] = [
    { pattern: "address", target: "address_1" },
    { pattern: "city", target: "city" },
    { pattern: "unit", target: "unit_name" },
    { pattern: "tenant", target: "resident_name" },
    { pattern: "resident", target: "resident_name" },
    { pattern: "inspection", target: "last_inspection_date" },
    { pattern: "type", target: "inspection_type" },
    { pattern: "due", target: "due_date" },
    { pattern: "owner", target: "owner_name" },
    { pattern: "priority", target: "priority" },
    { pattern: "note", target: "notes" },
    { pattern: "zip", target: "zip" },
    { pattern: "postal", target: "zip" },
  ];

  for (const rule of rules) {
    if (mapping[rule.target]) continue;
    const matchIdx = lowerHeaders.findIndex(
      (h) => h.includes(rule.pattern) && !Object.values(mapping).includes(headers[lowerHeaders.indexOf(h)])
    );
    if (matchIdx >= 0) {
      mapping[rule.target] = headers[matchIdx];
    }
  }

  return mapping;
}

// ────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────

export default function InspectionImportPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 state
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [columns, setColumns] = useState<ParsedColumn[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [importId, setImportId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  // Step 2 state
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [validating, setValidating] = useState(false);

  // Step 3 state
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [committedCount, setCommittedCount] = useState(0);

  // ── Step 1: File upload ──
  const handleFile = async (f: File) => {
    setFile(f);
    setUploadError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", f);
      const res = await fetch("/api/inspections/import", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      const data = await res.json();
      setColumns(data.columns || []);
      setPreviewRows(data.preview || []);
      setRawRows(data.rows || []);
      setRowCount(data.row_count || 0);
      setImportId(data.import_id || null);

      // Auto-map columns
      const headers = (data.columns || []).map((c: ParsedColumn) => c.header);
      setColumnMapping(autoMap(headers));

      setStep(2);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setUploadError(message);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f && (f.name.endsWith(".csv") || f.name.endsWith(".xlsx"))) {
      handleFile(f);
    } else {
      setUploadError("Please upload a CSV or XLSX file.");
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragActive(false);
  }, []);

  // ── Step 2: Validate ──
  const handleValidate = async () => {
    setValidating(true);
    try {
      const res = await fetch("/api/inspections/import/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_id: importId,
          column_mapping: columnMapping,
          rows: rawRows,
        }),
      });
      if (!res.ok) throw new Error("Validation failed");
      const raw = await res.json();

      // Transform API response into the shape the UI expects
      const allRows: ValidationRow[] = [
        ...(raw.valid || []).map((r: { rowNumber: number; data: Record<string, string>; issues: string[] }) => ({
          row_number: r.rowNumber,
          address: r.data.address_1 || "",
          city: r.data.city || "",
          unit: r.data.unit_name || "",
          type: r.data.inspection_type || "annual",
          due_date: r.data.due_date || "",
          status: "valid" as const,
          issues: r.issues,
        })),
        ...(raw.warnings || []).map((r: { rowNumber: number; data: Record<string, string>; issues: string[] }) => ({
          row_number: r.rowNumber,
          address: r.data.address_1 || "",
          city: r.data.city || "",
          unit: r.data.unit_name || "",
          type: r.data.inspection_type || "annual",
          due_date: r.data.due_date || "",
          status: "warning" as const,
          issues: r.issues,
        })),
        ...(raw.errors || []).map((r: { rowNumber: number; data: Record<string, string>; issues: string[] }) => ({
          row_number: r.rowNumber,
          address: r.data.address_1 || "",
          city: r.data.city || "",
          unit: r.data.unit_name || "",
          type: r.data.inspection_type || "annual",
          due_date: r.data.due_date || "",
          status: "error" as const,
          issues: r.issues,
        })),
        ...(raw.duplicates || []).map((r: { rowNumber: number; data: Record<string, string>; issues: string[] }) => ({
          row_number: r.rowNumber,
          address: r.data.address_1 || "",
          city: r.data.city || "",
          unit: r.data.unit_name || "",
          type: r.data.inspection_type || "annual",
          due_date: r.data.due_date || "",
          status: "duplicate" as const,
          issues: r.issues,
        })),
      ].sort((a, b) => a.row_number - b.row_number);

      const data: ValidationResult = {
        valid: raw.summary?.valid ?? 0,
        warnings: raw.summary?.warnings ?? 0,
        errors: raw.summary?.errors ?? 0,
        duplicates: raw.summary?.duplicates ?? 0,
        rows: allRows,
      };
      setValidationResult(data);

      // Pre-select valid and warning rows
      const preSelected = new Set<number>();
      for (const row of data.rows) {
        if (row.status === "valid" || row.status === "warning") {
          preSelected.add(row.row_number);
        }
      }
      setSelectedRows(preSelected);
      setStep(3);
    } catch (err) {
      console.error("Validation error:", err);
    } finally {
      setValidating(false);
    }
  };

  // ── Step 3: Commit ──
  const handleCommit = async () => {
    setCommitting(true);
    try {
      const res = await fetch("/api/inspections/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batch_id: importId,
          selected_rows: Array.from(selectedRows),
          column_mapping: columnMapping,
          rows: rawRows,
        }),
      });
      if (!res.ok) throw new Error("Commit failed");
      const data = await res.json();
      setCommittedCount(data.created || data.selected || selectedRows.size);
      setCommitted(true);
    } catch (err) {
      console.error("Commit error:", err);
    } finally {
      setCommitting(false);
    }
  };

  const toggleRowSelect = (rowNum: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowNum)) next.delete(rowNum);
      else next.add(rowNum);
      return next;
    });
  };

  const toggleAllRows = () => {
    if (!validationResult) return;
    if (selectedRows.size === validationResult.rows.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(validationResult.rows.map((r) => r.row_number)));
    }
  };

  // ── Mapping helpers ──
  const updateMapping = (targetKey: string, sourceHeader: string) => {
    setColumnMapping((prev) => {
      const next = { ...prev };
      if (sourceHeader) {
        next[targetKey] = sourceHeader;
      } else {
        delete next[targetKey];
      }
      return next;
    });
  };

  const requiredMapped = MAPPING_TARGETS.filter((t) => t.required).every(
    (t) => columnMapping[t.key]
  );

  // ── Validation status helpers ──
  const statusBadge = (status: string) => {
    switch (status) {
      case "valid":
        return "bg-green-100 text-green-700";
      case "warning":
        return "bg-amber-100 text-amber-700";
      case "error":
        return "bg-red-100 text-red-700";
      case "duplicate":
        return "bg-orange-100 text-orange-700";
      default:
        return "bg-charcoal-100 text-charcoal-600";
    }
  };

  // ────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────

  return (
    <main className="min-h-screen">
      <div className="container mx-auto px-4 py-8">
        <div className="space-y-6">
          {/* ── Back link + Header ── */}
          <div>
            <Link
              href="/maintenance/inspections"
              className="inline-flex items-center gap-1 text-sm text-charcoal-500 hover:text-charcoal-700 transition-colors mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Inspection Queue
            </Link>
            <h1 className="text-2xl font-bold text-charcoal-900">Import Inspections</h1>
            <p className="text-charcoal-500 text-sm mt-1">
              Upload a spreadsheet to add inspections to the queue.
            </p>
          </div>

          {/* ── Legacy notice ── */}
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <strong>Tip:</strong> The primary inspection flow now pulls directly from AppFolio.
            Use{" "}
            <Link
              href="/maintenance/inspections/candidates"
              className="underline font-semibold hover:text-blue-700"
            >
              AppFolio Candidates
            </Link>{" "}
            for properties flagged with "Use Custom Inspection Date" — recently inspected
            units are skipped automatically. This XLSX import is still available for one-off
            uploads.
          </div>

          {/* ── Step Indicators ── */}
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                    step >= s
                      ? "bg-terra-500 text-white"
                      : "bg-charcoal-100 text-charcoal-400"
                  )}
                >
                  {step > s ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    s
                  )}
                </div>
                <span
                  className={cn(
                    "text-sm font-medium",
                    step >= s ? "text-charcoal-900" : "text-charcoal-400"
                  )}
                >
                  {s === 1 ? "Upload" : s === 2 ? "Map Columns" : "Review & Import"}
                </span>
                {s < 3 && (
                  <div
                    className={cn(
                      "w-12 h-px mx-2",
                      step > s ? "bg-terra-500" : "bg-charcoal-200"
                    )}
                  />
                )}
              </div>
            ))}
          </div>

          {/* ── Step 1: Upload ── */}
          {step === 1 && (
            <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-8">
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors",
                  dragActive
                    ? "border-terra-500 bg-terra-50"
                    : "border-charcoal-300 hover:border-charcoal-400 hover:bg-charcoal-50"
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
                {uploading ? (
                  <div className="flex flex-col items-center gap-3">
                    <RefreshCw className="w-10 h-10 text-terra-500 animate-spin" />
                    <p className="text-sm text-charcoal-600">Parsing file...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <FileSpreadsheet className="w-10 h-10 text-charcoal-400" />
                    <div>
                      <p className="text-sm font-medium text-charcoal-700">
                        Drop CSV or XLSX file here
                      </p>
                      <p className="text-xs text-charcoal-400 mt-1">
                        or click to browse
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {uploadError && (
                <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                  <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{uploadError}</p>
                </div>
              )}

              {file && !uploading && columns.length === 0 && !uploadError && (
                <div className="mt-4 text-sm text-charcoal-600">
                  Selected: <span className="font-medium">{file.name}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Column Mapping ── */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-charcoal-900">Column Mapping</h2>
                    <p className="text-sm text-charcoal-500 mt-1">
                      {file?.name} &mdash; {rowCount} rows detected
                    </p>
                  </div>
                  <button
                    onClick={() => setStep(1)}
                    className="text-sm text-charcoal-500 hover:text-charcoal-700 transition-colors"
                  >
                    Choose different file
                  </button>
                </div>

                <div className="space-y-3">
                  {MAPPING_TARGETS.map((target) => (
                    <div key={target.key} className="flex items-center gap-4">
                      <div className="w-48 flex items-center gap-2">
                        <span className="text-sm font-medium text-charcoal-700">
                          {target.label}
                        </span>
                        {target.required && (
                          <span className="text-xs text-red-500 font-semibold">*</span>
                        )}
                      </div>
                      <ArrowRight className="w-4 h-4 text-charcoal-300 flex-shrink-0" />
                      <div className="relative flex-1 max-w-xs">
                        <select
                          value={columnMapping[target.key] || ""}
                          onChange={(e) => updateMapping(target.key, e.target.value)}
                          className={cn(
                            "w-full appearance-none bg-white border rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-terra-400 focus:border-transparent",
                            columnMapping[target.key]
                              ? "border-green-300 text-charcoal-700"
                              : target.required
                                ? "border-red-300 text-charcoal-400"
                                : "border-charcoal-300 text-charcoal-400"
                          )}
                        >
                          <option value="">-- Select column --</option>
                          {columns.map((col) => (
                            <option key={col.index} value={col.header}>
                              {col.header}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview */}
              {previewRows.length > 0 && (
                <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-6">
                  <h3 className="text-sm font-semibold text-charcoal-700 mb-3">
                    Preview (first {previewRows.length} rows)
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-charcoal-50 border-b border-charcoal-200">
                          <th className="text-left px-3 py-2 font-semibold text-charcoal-600">Row</th>
                          {MAPPING_TARGETS.filter((t) => columnMapping[t.key]).map((t) => (
                            <th
                              key={t.key}
                              className="text-left px-3 py-2 font-semibold text-charcoal-600"
                            >
                              {t.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-charcoal-100">
                        {previewRows.map((row) => (
                          <tr key={row.row_number}>
                            <td className="px-3 py-2 text-charcoal-400">{row.row_number}</td>
                            {MAPPING_TARGETS.filter((t) => columnMapping[t.key]).map((t) => (
                              <td key={t.key} className="px-3 py-2 text-charcoal-600">
                                {row.data[columnMapping[t.key]] || "\u2014"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <button
                  onClick={() => setStep(1)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-charcoal-600 hover:bg-charcoal-50 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  onClick={handleValidate}
                  disabled={!requiredMapped || validating}
                  className={cn(
                    "flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium transition-colors",
                    "bg-terra-500 text-white hover:bg-terra-600 disabled:opacity-60"
                  )}
                >
                  {validating ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Validating...
                    </>
                  ) : (
                    <>
                      Validate
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Validation Preview ── */}
          {step === 3 && !committed && validationResult && (
            <div className="space-y-6">
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="text-xs font-medium text-charcoal-500">Valid</span>
                  </div>
                  <p className="text-2xl font-bold text-green-600">{validationResult.valid}</p>
                </div>
                <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <span className="text-xs font-medium text-charcoal-500">Warnings</span>
                  </div>
                  <p className="text-2xl font-bold text-amber-600">{validationResult.warnings}</p>
                </div>
                <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <XCircle className="w-4 h-4 text-red-500" />
                    <span className="text-xs font-medium text-charcoal-500">Errors</span>
                  </div>
                  <p className="text-2xl font-bold text-red-600">{validationResult.errors}</p>
                </div>
                <div className="bg-white rounded-xl shadow-card border border-charcoal-200 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Copy className="w-4 h-4 text-orange-500" />
                    <span className="text-xs font-medium text-charcoal-500">Duplicates</span>
                  </div>
                  <p className="text-2xl font-bold text-orange-600">{validationResult.duplicates}</p>
                </div>
              </div>

              {/* Validation table */}
              <div className="bg-white rounded-xl shadow-card border border-charcoal-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-charcoal-50 border-b border-charcoal-200">
                        <th className="w-10 px-3 py-3">
                          <input
                            type="checkbox"
                            checked={
                              selectedRows.size === validationResult.rows.length &&
                              validationResult.rows.length > 0
                            }
                            onChange={toggleAllRows}
                            className="rounded border-charcoal-300"
                          />
                        </th>
                        <th className="text-left px-3 py-3 font-semibold text-charcoal-600 w-14">
                          Row
                        </th>
                        <th className="text-left px-3 py-3 font-semibold text-charcoal-600">
                          Address
                        </th>
                        <th className="text-left px-3 py-3 font-semibold text-charcoal-600">
                          City
                        </th>
                        <th className="text-left px-3 py-3 font-semibold text-charcoal-600">
                          Unit
                        </th>
                        <th className="text-left px-3 py-3 font-semibold text-charcoal-600">
                          Type
                        </th>
                        <th className="text-left px-3 py-3 font-semibold text-charcoal-600">
                          Due Date
                        </th>
                        <th className="text-left px-3 py-3 font-semibold text-charcoal-600">
                          Status
                        </th>
                        <th className="text-left px-3 py-3 font-semibold text-charcoal-600">
                          Issues
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-charcoal-100">
                      {validationResult.rows.map((row) => (
                        <tr
                          key={row.row_number}
                          className={cn(
                            "hover:bg-charcoal-50 transition-colors",
                            selectedRows.has(row.row_number) && "bg-terra-50"
                          )}
                        >
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={selectedRows.has(row.row_number)}
                              onChange={() => toggleRowSelect(row.row_number)}
                              className="rounded border-charcoal-300"
                            />
                          </td>
                          <td className="px-3 py-3 font-mono text-xs text-charcoal-400">
                            {row.row_number}
                          </td>
                          <td className="px-3 py-3 text-charcoal-700 truncate max-w-[200px]">
                            {row.address || "\u2014"}
                          </td>
                          <td className="px-3 py-3 text-charcoal-600">{row.city || "\u2014"}</td>
                          <td className="px-3 py-3 text-charcoal-600">{row.unit || "\u2014"}</td>
                          <td className="px-3 py-3 text-charcoal-600">{row.type || "\u2014"}</td>
                          <td className="px-3 py-3 text-charcoal-600">{row.due_date || "\u2014"}</td>
                          <td className="px-3 py-3">
                            <span
                              className={cn(
                                "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
                                statusBadge(row.status)
                              )}
                            >
                              {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            {row.issues.length > 0 ? (
                              <ul className="text-xs text-charcoal-500 space-y-0.5">
                                {row.issues.map((issue, i) => (
                                  <li key={i}>{issue}</li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-xs text-green-600">OK</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={() => setStep(2)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-charcoal-600 hover:bg-charcoal-50 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Mapping
                </button>
                <button
                  onClick={handleCommit}
                  disabled={selectedRows.size === 0 || committing}
                  className={cn(
                    "flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium transition-colors",
                    "bg-terra-500 text-white hover:bg-terra-600 disabled:opacity-60"
                  )}
                >
                  {committing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Commit Import ({selectedRows.size} rows)
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── Success State ── */}
          {step === 3 && committed && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-6">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <h2 className="text-2xl font-bold text-charcoal-900 mb-2">Import complete</h2>
              <p className="text-charcoal-500 mb-6">
                {committedCount} inspection{committedCount !== 1 ? "s" : ""} imported successfully.
              </p>
              <Link
                href="/maintenance/inspections"
                className="inline-flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium bg-terra-500 text-white hover:bg-terra-600 transition-colors"
              >
                Back to Inspection Queue
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

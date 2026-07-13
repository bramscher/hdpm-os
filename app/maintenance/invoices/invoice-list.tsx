"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Download,
  CheckCircle2,
  XCircle,
  Pencil,
  Trash2,
  Loader2,
  FileText,
  RefreshCw,
  Eye,
  X,
  CheckSquare,
  Square,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  BarChart3,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HdmsInvoice } from "@/lib/invoices";

interface InvoiceListProps {
  invoices: HdmsInvoice[];
  onRefresh: () => void;
  onEdit: (invoice: HdmsInvoice) => void;
  onRunReport: (invoices: HdmsInvoice[]) => void;
  isLoading: boolean;
}

// ── Sort + date helpers ──────────
type SortField = "date" | "number" | "amount" | "property";

/** The date an invoice is filtered/sorted on: completed date, falling back to created. */
function invoiceDate(inv: HdmsInvoice): Date | null {
  const raw = inv.completed_date || inv.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/** Parse a YYYY-MM-DD input into a local day-boundary date, or null. */
function parseDateInput(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? null : date;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: "bg-charcoal-100/80", text: "text-charcoal-600", label: "Draft" },
  generated: { bg: "bg-blue-100/80", text: "text-blue-700", label: "Generated" },
  attached: { bg: "bg-terra-100/80", text: "text-terra-700", label: "Attached" },
  void: { bg: "bg-red-100/80", text: "text-red-600", label: "Void" },
};

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ============================================
// PDF Preview Modal
// ============================================

function PdfPreviewModal({
  invoice,
  onClose,
  onDownload,
}: {
  invoice: HdmsInvoice;
  onClose: () => void;
  onDownload: () => void;
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUrl() {
      try {
        const res = await fetch(`/api/invoices/${invoice.id}/download`);
        const data = await res.json();
        if (res.ok && data.downloadUrl) {
          setPdfUrl(data.downloadUrl);
        } else {
          setError(data.error || "Failed to load PDF");
        }
      } catch {
        setError("Failed to load PDF");
      } finally {
        setLoading(false);
      }
    }
    fetchUrl();
  }, [invoice.id]);

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-4xl h-[90vh] mx-4 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-charcoal-200/60 bg-charcoal-50/80">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-terra-600" />
            <div>
              <span className="font-semibold text-charcoal-900 text-sm">
                {invoice.invoice_code}
              </span>
              <span className="ml-2 text-xs text-charcoal-500">
                {invoice.property_name}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onDownload}
              className="text-xs h-8"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download
            </Button>
            <button
              onClick={onClose}
              className="flex items-center justify-center h-8 w-8 rounded-lg text-charcoal-400 hover:text-charcoal-600 hover:bg-charcoal-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* PDF Content */}
        <div className="flex-1 bg-charcoal-100">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-terra-500" />
                <p className="text-sm text-charcoal-500">Loading PDF...</p>
              </div>
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-sm text-red-600">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClose}
                  className="mt-3"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
          {pdfUrl && !loading && !error && (
            <iframe
              src={pdfUrl}
              className="w-full h-full border-0"
              title={`Preview ${invoice.invoice_code}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Invoice List
// ============================================

export function InvoiceList({ invoices, onRefresh, onEdit, onRunReport, isLoading }: InvoiceListProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [previewInvoice, setPreviewInvoice] = useState<HdmsInvoice | null>(null);

  // ── Selection / filter / sort state ──────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Filtered + sorted invoices for display.
  const visible = useMemo(() => {
    const from = parseDateInput(dateFrom);
    const to = parseDateInput(dateTo);
    const fromMs = from ? from.getTime() : null;
    const toMs = to ? to.getTime() : null;
    const q = search.trim().toLowerCase();

    const filtered = invoices.filter((inv) => {
      // Text search across invoice code, property, address, WO ref, description.
      if (q) {
        const haystack = [
          inv.invoice_code,
          inv.property_name,
          inv.property_address,
          inv.wo_reference,
          inv.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      if (fromMs === null && toMs === null) return true;
      const d = invoiceDate(inv);
      if (!d) return false;
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      if (fromMs !== null && t < fromMs) return false;
      if (toMs !== null && t > toMs) return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === "number") {
        cmp = (a.invoice_number || 0) - (b.invoice_number || 0);
      } else if (sortField === "amount") {
        cmp = (a.total_amount || 0) - (b.total_amount || 0);
      } else if (sortField === "property") {
        cmp = (a.property_name || "").localeCompare(b.property_name || "");
      } else {
        const ad = invoiceDate(a)?.getTime() ?? 0;
        const bd = invoiceDate(b)?.getTime() ?? 0;
        cmp = ad - bd;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [invoices, search, dateFrom, dateTo, sortField, sortDir]);

  // Drop any selected IDs that are no longer present (e.g. after delete/refresh).
  useEffect(() => {
    setSelectedIds((prev) => {
      const live = new Set(invoices.map((i) => i.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [invoices]);

  const selectedInvoices = useMemo(
    () => invoices.filter((i) => selectedIds.has(i.id)),
    [invoices, selectedIds]
  );

  const visibleSelectedCount = visible.filter((i) => selectedIds.has(i.id)).length;
  const allVisibleSelected = visible.length > 0 && visibleSelectedCount === visible.length;
  const hasDateFilter = !!dateFrom || !!dateTo;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const inv of visible) next.delete(inv.id);
      } else {
        for (const inv of visible) next.add(inv.id);
      }
      return next;
    });
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "property" ? "asc" : "desc");
    }
  }

  function SortButton({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field;
    const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => handleSort(field)}
        className={cn(
          "inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-full transition-all duration-200",
          active
            ? "bg-terra-100/80 text-terra-700 ring-1 ring-terra-300 shadow-sm"
            : "bg-charcoal-50 text-charcoal-500 hover:bg-charcoal-100 hover:text-charcoal-700"
        )}
      >
        {label}
        <Icon className={cn("h-3 w-3", active ? "text-terra-600" : "text-charcoal-300")} />
      </button>
    );
  }

  async function handleDownload(invoice: HdmsInvoice) {
    setActionLoading(`download-${invoice.id}`);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/download`);
      const data = await res.json();
      if (res.ok && data.downloadUrl) {
        window.open(data.downloadUrl, "_blank");
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function handleStatusChange(invoice: HdmsInvoice, status: string) {
    setActionLoading(`status-${invoice.id}`);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        onRefresh();
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(invoice: HdmsInvoice) {
    setActionLoading(`delete-${invoice.id}`);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onRefresh();
      }
    } finally {
      setActionLoading(null);
      setDeleteConfirm(null);
    }
  }

  if (invoices.length === 0 && !isLoading) {
    return null;
  }

  return (
    <>
      {/* PDF Preview Modal */}
      {previewInvoice && (
        <PdfPreviewModal
          invoice={previewInvoice}
          onClose={() => setPreviewInvoice(null)}
          onDownload={() => {
            handleDownload(previewInvoice);
            setPreviewInvoice(null);
          }}
        />
      )}

      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-charcoal-900">Recent Invoices</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            className="text-charcoal-500"
          >
            <RefreshCw className={cn("h-4 w-4 mr-1", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Selection / filter / sort toolbar */}
        <div className="bg-white rounded-xl border border-sand-200 shadow-card px-4 py-3 mb-4 space-y-3">
          {/* Text search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-charcoal-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice #, property, address, WO#..."
              className="w-full h-9 pl-8 pr-8 text-xs bg-white border border-sand-200 rounded-lg text-charcoal-700 focus:outline-none focus:ring-1 focus:ring-terra-300"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                title="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-charcoal-400 hover:text-charcoal-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-medium text-charcoal-400 uppercase mr-1">Sort:</span>
              <SortButton field="date" label="Date" />
              <SortButton field="number" label="Invoice #" />
              <SortButton field="amount" label="Amount" />
              <SortButton field="property" label="Property" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-medium text-charcoal-400 uppercase">From:</span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 px-2 text-xs bg-white border border-sand-200 rounded-lg text-charcoal-700 focus:outline-none focus:ring-1 focus:ring-terra-300"
              />
              <span className="text-[10px] font-medium text-charcoal-400 uppercase">To:</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 px-2 text-xs bg-white border border-sand-200 rounded-lg text-charcoal-700 focus:outline-none focus:ring-1 focus:ring-terra-300"
              />
              {hasDateFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                  className="text-[10px] text-charcoal-400 hover:text-charcoal-600 underline"
                >
                  clear
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-sand-100">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleSelectAllVisible}
                disabled={visible.length === 0}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-charcoal-600 hover:text-charcoal-900 disabled:opacity-40"
              >
                {allVisibleSelected ? (
                  <CheckSquare className="h-4 w-4 text-terra-600" />
                ) : (
                  <Square className="h-4 w-4 text-charcoal-400" />
                )}
                {allVisibleSelected ? "Deselect all" : "Select all"}
              </button>
              <span className="text-[11px] text-charcoal-400">
                {selectedIds.size} selected
                {(hasDateFilter || search.trim()) && (
                  <span className="text-charcoal-300"> · {visible.length} shown</span>
                )}
              </span>
            </div>
            <Button
              size="sm"
              onClick={() => onRunReport(selectedInvoices)}
              disabled={selectedIds.size === 0}
              className="bg-terra-500 hover:bg-terra-600 text-white text-xs h-8 disabled:opacity-40"
            >
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              Report from selection{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
            </Button>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="bg-white rounded-xl border border-sand-200 shadow-card px-4 py-10 text-center text-charcoal-400 text-xs">
            No invoices match your search or date range.
          </div>
        ) : (
        <div className="space-y-3">
          {visible.map((invoice) => {
            const statusStyle = STATUS_STYLES[invoice.status] || STATUS_STYLES.draft;
            const isVoid = invoice.status === "void";
            const isConfirmingDelete = deleteConfirm === invoice.id;
            const lineItemCount = invoice.line_items?.length || 0;
            const hasPdf = invoice.pdf_path && (invoice.status === "generated" || invoice.status === "attached");
            const isSelected = selectedIds.has(invoice.id);

            return (
              <div
                key={invoice.id}
                className={cn(
                  "glass rounded-xl p-4 transition-all duration-200",
                  isVoid && "opacity-60",
                  isSelected && "ring-2 ring-terra-300 bg-terra-50/40"
                )}
              >
                <div className="flex items-center gap-4">
                  {/* Left: Invoice info */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Selection checkbox */}
                    <button
                      type="button"
                      onClick={() => toggleSelect(invoice.id)}
                      title={isSelected ? "Deselect" : "Select for report"}
                      className="shrink-0 text-charcoal-400 hover:text-terra-600 transition-colors"
                    >
                      {isSelected ? (
                        <CheckSquare className="h-5 w-5 text-terra-600" />
                      ) : (
                        <Square className="h-5 w-5" />
                      )}
                    </button>
                    <div
                      className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                        hasPdf
                          ? "bg-terra-100/80 cursor-pointer hover:bg-terra-200/80"
                          : "bg-terra-100/80"
                      )}
                      onClick={() => hasPdf && setPreviewInvoice(invoice)}
                      title={hasPdf ? "Preview PDF" : undefined}
                    >
                      {hasPdf ? (
                        <Eye className="h-5 w-5 text-terra-700" />
                      ) : (
                        <FileText className="h-5 w-5 text-terra-700" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "font-semibold text-charcoal-900 text-sm",
                            hasPdf && "cursor-pointer hover:text-terra-700 transition-colors"
                          )}
                          onClick={() => hasPdf && setPreviewInvoice(invoice)}
                        >
                          {invoice.invoice_code}
                        </span>
                        <span
                          className={cn(
                            "text-xs px-2 py-0.5 rounded-full font-medium",
                            statusStyle.bg,
                            statusStyle.text
                          )}
                        >
                          {statusStyle.label}
                        </span>
                        {invoice.wo_reference && (
                          <span className="text-[10px] text-charcoal-400 font-mono">
                            WO#{invoice.wo_reference}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-charcoal-600 truncate">
                        {invoice.property_name}
                      </p>
                      <p className="text-xs text-charcoal-400">
                        {formatDate(invoice.created_at)}
                        {lineItemCount > 0 && (
                          <span className="ml-2 text-charcoal-300">
                            • {lineItemCount} line item{lineItemCount !== 1 ? "s" : ""}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Amount — fixed-width column so totals right-align across rows */}
                  <div className="text-right shrink-0 w-36">
                    <span className="text-lg font-semibold text-charcoal-900">
                      {formatCurrency(invoice.total_amount)}
                    </span>
                    {(invoice.labor_amount > 0 || invoice.materials_amount > 0) && invoice.labor_amount !== invoice.total_amount && (
                      <div className="text-[10px] text-charcoal-400 mt-0.5">
                        {invoice.labor_amount > 0 && (
                          <span className="text-blue-500">L: {formatCurrency(invoice.labor_amount)}</span>
                        )}
                        {invoice.labor_amount > 0 && invoice.materials_amount > 0 && (
                          <span className="mx-1">·</span>
                        )}
                        {invoice.materials_amount > 0 && (
                          <span className="text-amber-500">M: {formatCurrency(invoice.materials_amount)}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions — right-aligned in a consistent-width column regardless of button count */}
                  <div className="flex items-center justify-end gap-1 shrink-0 min-w-[224px]">
                    {/* Preview */}
                    {hasPdf && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPreviewInvoice(invoice)}
                        disabled={actionLoading !== null}
                        title="Preview PDF"
                        className="text-terra-600 hover:text-terra-700 hover:bg-terra-50 h-8 w-8 p-0"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    )}

                    {/* Edit — available for all non-void invoices */}
                    {!isVoid && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(invoice)}
                        disabled={actionLoading !== null}
                        title="Edit invoice"
                        className="h-8 w-8 p-0"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}

                    {/* Download */}
                    {hasPdf && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownload(invoice)}
                        disabled={actionLoading !== null}
                        title="Download PDF"
                        className="h-8 w-8 p-0"
                      >
                        {actionLoading === `download-${invoice.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}

                    {/* Mark as Attached */}
                    {invoice.status === "generated" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStatusChange(invoice, "attached")}
                        disabled={actionLoading !== null}
                        title="Mark as attached — after you've uploaded this PDF to AppFolio yourself (this only updates the local status; it does not upload to AppFolio)"
                        className="text-terra-600 hover:text-terra-700 hover:bg-terra-50 h-8 w-8 p-0"
                      >
                        {actionLoading === `status-${invoice.id}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}

                    {/* Void */}
                    {!isVoid && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStatusChange(invoice, "void")}
                        disabled={actionLoading !== null}
                        title="Void invoice"
                        className="text-red-400 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}

                    {/* Delete */}
                    {isConfirmingDelete ? (
                      <div className="flex items-center gap-1 ml-1 pl-1 border-l border-charcoal-200">
                        <span className="text-[10px] text-red-600 font-medium whitespace-nowrap">Delete?</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(invoice)}
                          disabled={actionLoading !== null}
                          className="text-red-600 hover:bg-red-50 h-7 px-2 text-[10px] font-semibold"
                        >
                          {actionLoading === `delete-${invoice.id}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Yes"
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirm(null)}
                          disabled={actionLoading !== null}
                          className="text-charcoal-500 hover:bg-charcoal-50 h-7 px-2 text-[10px]"
                        >
                          No
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirm(invoice.id)}
                        disabled={actionLoading !== null}
                        title="Delete invoice"
                        className="text-charcoal-300 hover:text-red-500 hover:bg-red-50 h-8 w-8 p-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>
    </>
  );
}

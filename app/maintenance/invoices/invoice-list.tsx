"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Download,
  CheckCircle2,
  XCircle,
  Pencil,
  Copy,
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
  Wallet,
  Search,
  ChevronLeft,
  ChevronRight,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HdmsInvoice, TECHNICIANS } from "@/lib/invoices";

// How many invoice cards to show per page.
const PAGE_SIZE = 25;

interface InvoiceListProps {
  invoices: HdmsInvoice[];
  onRefresh: () => void;
  onEdit: (invoice: HdmsInvoice) => void;
  /** Duplicate an invoice (same number + next suffix). Button hidden when omitted. */
  onDuplicate?: (invoice: HdmsInvoice) => void | Promise<void>;
  /** Open the internal markup report for the selected invoices. Button hidden when omitted. */
  onRunReport?: (invoices: HdmsInvoice[]) => void;
  /** Reconcile the selected invoices to a trust-account payment. Button hidden when omitted. */
  onReconcile?: (invoices: HdmsInvoice[]) => void;
  /**
   * Persist the checkbox selection per user + period (the date-range filter), so
   * the user can leave mid-reconcile and resume. Auto-saves on every change and
   * restores when the period is reopened. Only enable in the reconcile flow.
   */
  persistSelection?: boolean;
  /**
   * Bump to signal that reconciliation for the current period committed: the
   * saved draft is deleted and the selection cleared. (Paired with persistSelection.)
   */
  clearSelectionToken?: number;
  isLoading: boolean;
}

type PaidFilter = "all" | "unpaid" | "paid";

/** Tech filter: "all", a staff name, or "none" (no staff attribution). */
type TechFilter = string;

// ── Sort + date helpers ──────────
type SortField = "date" | "number" | "amount" | "property" | "tech";

/** The date an invoice is filtered/sorted on: completed date, falling back to created. */
/**
 * The invoice's date for display, filtering, and sorting — the work-completed
 * date when set, else record creation. Date-only strings are parsed as LOCAL
 * (new Date("YYYY-MM-DD") is UTC midnight, which lands on the previous day in
 * Pacific and made range boundaries filter off by one).
 */
function invoiceDate(inv: HdmsInvoice): Date | null {
  const raw = inv.completed_date || inv.created_at;
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(raw);
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
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
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

export function InvoiceList({ invoices, onRefresh, onEdit, onDuplicate, onRunReport, onReconcile, persistSelection, clearSelectionToken, isLoading }: InvoiceListProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [previewInvoice, setPreviewInvoice] = useState<HdmsInvoice | null>(null);

  // ── Selection / filter / sort state ──────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [paidFilter, setPaidFilter] = useState<PaidFilter>("all");
  const [afBilledOnly, setAfBilledOnly] = useState(false);
  const [techFilter, setTechFilter] = useState<TechFilter>("all");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Staff names present in the data, known technicians first (Brody, Alberto, …).
  const techOptions = useMemo(() => {
    const names = new Set<string>();
    for (const inv of invoices) if (inv.assigned_tech) names.add(inv.assigned_tech);
    const known = TECHNICIANS.filter((t) => names.has(t));
    const rest = [...names].filter((n) => !(TECHNICIANS as readonly string[]).includes(n)).sort();
    return [...known, ...rest];
  }, [invoices]);
  const hasUnassigned = useMemo(() => invoices.some((i) => !i.assigned_tech), [invoices]);

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
          inv.assigned_tech,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      // Paid / unpaid filter (payment_id presence = reconciled to a payment).
      if (paidFilter === "paid" && !inv.payment_id) return false;
      if (paidFilter === "unpaid" && inv.payment_id) return false;

      // AF-billed filter: only invoices with a matched AppFolio bill amount.
      if (afBilledOnly && !((inv.af_billed_total ?? 0) > 0)) return false;

      // Assigned-staff filter.
      if (techFilter === "none" && inv.assigned_tech) return false;
      if (techFilter !== "all" && techFilter !== "none" && inv.assigned_tech !== techFilter)
        return false;

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
      } else if (sortField === "tech") {
        // Unassigned sorts last regardless of direction.
        if (!a.assigned_tech && !b.assigned_tech) cmp = 0;
        else if (!a.assigned_tech) return 1;
        else if (!b.assigned_tech) return -1;
        else cmp = a.assigned_tech.localeCompare(b.assigned_tech);
      } else {
        const ad = invoiceDate(a)?.getTime() ?? 0;
        const bd = invoiceDate(b)?.getTime() ?? 0;
        cmp = ad - bd;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [invoices, search, dateFrom, dateTo, paidFilter, afBilledOnly, techFilter, sortField, sortDir]);

  // ── Pagination over the filtered/sorted list ──────────
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));

  // Snap back to page 1 whenever the filter/sort inputs change.
  useEffect(() => {
    setPage(1);
  }, [search, dateFrom, dateTo, paidFilter, afBilledOnly, techFilter, sortField, sortDir]);

  // Keep the page in range if the underlying list shrinks (e.g. after a delete).
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const paginated = useMemo(
    () => visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [visible, page]
  );

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

  // ── Save & resume: persist the checkbox selection per user + period ──────────
  // The period key is the date-range filter. restoredKeyRef tracks which period
  // we've loaded so the auto-save never writes one period's selection under
  // another's key, and skipNextSave suppresses the echo save right after a restore.
  const restoredKeyRef = useRef<string | null>(null);
  const skipNextSaveRef = useRef(false);
  const seenClearTokenRef = useRef(clearSelectionToken);

  // Restore the saved selection when a (new) period is opened.
  useEffect(() => {
    if (!persistSelection) return;
    const key = `${dateFrom}|${dateTo}`;
    if (restoredKeyRef.current === key) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/reconcile-selection?from=${encodeURIComponent(dateFrom)}&to=${encodeURIComponent(dateTo)}`
        );
        const data = await res.json();
        if (cancelled) return;
        const ids: string[] = Array.isArray(data.selection?.invoice_ids)
          ? data.selection.invoice_ids
          : [];
        skipNextSaveRef.current = true;
        setSelectedIds(new Set(ids));
      } catch {
        // best-effort restore; leave the current selection untouched on failure
      } finally {
        if (!cancelled) restoredKeyRef.current = key;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [persistSelection, dateFrom, dateTo]);

  // Auto-save (debounced) on every check/uncheck, once this period is restored.
  useEffect(() => {
    if (!persistSelection) return;
    const key = `${dateFrom}|${dateTo}`;
    if (restoredKeyRef.current !== key) return; // wait for this period's restore
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    const ids = [...selectedIds];
    const t = setTimeout(() => {
      fetch("/api/reconcile-selection", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: dateFrom, to: dateTo, invoice_ids: ids }),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [persistSelection, selectedIds, dateFrom, dateTo]);

  // Reconciliation committed → clear this period's saved draft and selection.
  useEffect(() => {
    if (!persistSelection || clearSelectionToken === undefined) return;
    if (seenClearTokenRef.current === clearSelectionToken) return;
    seenClearTokenRef.current = clearSelectionToken;
    skipNextSaveRef.current = true;
    setSelectedIds(new Set());
    fetch(
      `/api/reconcile-selection?from=${encodeURIComponent(dateFrom)}&to=${encodeURIComponent(dateTo)}`,
      { method: "DELETE" }
    ).catch(() => {});
  }, [clearSelectionToken, persistSelection, dateFrom, dateTo]);

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
      setSortDir(field === "property" || field === "tech" ? "asc" : "desc");
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

  async function handleDuplicate(invoice: HdmsInvoice) {
    if (!onDuplicate || duplicatingId) return;
    setDuplicatingId(invoice.id);
    try {
      await onDuplicate(invoice);
    } finally {
      setDuplicatingId(null);
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
          <h3 className="text-lg font-semibold text-charcoal-900">
            All Invoices
            <span className="ml-2 text-sm font-normal text-charcoal-400">({invoices.length})</span>
          </h3>
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
              <SortButton field="tech" label="Assigned" />
              <span className="mx-1 text-sand-300">|</span>
              <div className="inline-flex rounded-lg border border-sand-200 overflow-hidden">
                {(["all", "unpaid", "paid"] as PaidFilter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setPaidFilter(f)}
                    className={cn(
                      "px-2 py-1 text-[10px] font-medium capitalize transition-colors",
                      paidFilter === f
                        ? "bg-terra-500 text-white"
                        : "bg-white text-charcoal-500 hover:text-charcoal-700"
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setAfBilledOnly((v) => !v)}
                title="Only invoices with a matched AppFolio bill amount greater than $0.00"
                className={cn(
                  "px-2 py-1 text-[10px] font-medium rounded-lg border border-sand-200 transition-colors",
                  afBilledOnly
                    ? "bg-terra-500 text-white"
                    : "bg-white text-charcoal-500 hover:text-charcoal-700"
                )}
              >
                AF billed
              </button>
              {techOptions.length > 0 && (
                <>
                  <span className="mx-1 text-sand-300">|</span>
                  <span className="text-[10px] font-medium text-charcoal-400 uppercase mr-1">Assigned:</span>
                  <div className="inline-flex rounded-lg border border-sand-200 overflow-hidden">
                    {["all", ...techOptions, ...(hasUnassigned ? ["none"] : [])].map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setTechFilter(f)}
                        className={cn(
                          "px-2 py-1 text-[10px] font-medium transition-colors",
                          (f === "all" || f === "none") && "capitalize",
                          techFilter === f
                            ? "bg-terra-500 text-white"
                            : "bg-white text-charcoal-500 hover:text-charcoal-700"
                        )}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </>
              )}
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
                {persistSelection && (
                  <span className="text-charcoal-300"> · saved for this period</span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {onRunReport && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRunReport(selectedInvoices)}
                  disabled={selectedIds.size === 0}
                  className="text-xs h-8 disabled:opacity-40"
                >
                  <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
                  Report from selection{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
                </Button>
              )}
              {onReconcile && (
                <Button
                  size="sm"
                  onClick={() => onReconcile(selectedInvoices)}
                  disabled={selectedIds.size === 0}
                  className="bg-terra-500 hover:bg-terra-600 text-white text-xs h-8 disabled:opacity-40"
                >
                  <Wallet className="h-3.5 w-3.5 mr-1.5" />
                  Reconcile payment{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
                </Button>
              )}
            </div>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="bg-white rounded-xl border border-sand-200 shadow-card px-4 py-10 text-center text-charcoal-400 text-xs">
            No invoices match your search or date range.
          </div>
        ) : (
        <>
        <div className="space-y-3">
          {paginated.map((invoice) => {
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
                        {invoice.doc_type === "credit" && (
                          <span
                            title="Credit memo — a negative-amount document that offsets an invoice"
                            className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700"
                          >
                            Credit
                          </span>
                        )}
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
                        {invoice.assigned_tech && (
                          <span
                            title="Staff assigned to the work order"
                            className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-100/80 text-blue-700"
                          >
                            <UserRound className="h-2.5 w-2.5" />
                            {invoice.assigned_tech}
                          </span>
                        )}
                        {invoice.payment_id && (
                          <span
                            title={
                              invoice.af_bill_status === "match"
                                ? "Paid and AppFolio bill matches — fully reconciled"
                                : "Reconciled to a trust-account payment"
                            }
                            className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full font-medium bg-green-100/80 text-green-700"
                          >
                            <Wallet className="h-2.5 w-2.5" />
                            {invoice.af_bill_status === "match" ? "Reconciled" : "Paid"}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-charcoal-600 truncate">
                        {invoice.property_name}
                      </p>
                      <p
                        className="text-xs text-charcoal-400"
                        title="Work completed date (falls back to invoice creation) — the date the From/To filter and Date sort use"
                      >
                        {(() => {
                          const d = invoiceDate(invoice);
                          return d
                            ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                            : formatDate(invoice.created_at);
                        })()}
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
                    <span
                      className={cn(
                        "text-lg font-semibold",
                        invoice.doc_type === "credit" ? "text-red-600" : "text-charcoal-900"
                      )}
                    >
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
                    {/* AppFolio billing check: the bill amount entered in AppFolio
                        next to our invoice total (green = matches to the cent). */}
                    {invoice.af_bill_status === "match" && (
                      <div className="text-[10px] font-medium text-green-600 mt-0.5" title="AppFolio bill matches this invoice amount">
                        AF: {formatCurrency(invoice.af_billed_total ?? 0)} ✓
                      </div>
                    )}
                    {invoice.af_bill_status === "mismatch" && (
                      <div
                        className="text-[10px] font-medium text-amber-600 mt-0.5"
                        title={`AppFolio billed ${formatCurrency(invoice.af_billed_total ?? 0)} vs invoice ${formatCurrency(invoice.total_amount)}`}
                      >
                        AF: {formatCurrency(invoice.af_billed_total ?? 0)} (
                        {(invoice.af_billed_total ?? 0) > invoice.total_amount ? "+" : "−"}
                        {formatCurrency(Math.abs((invoice.af_billed_total ?? 0) - invoice.total_amount))})
                      </div>
                    )}
                    {invoice.af_bill_status === "unbilled" && (
                      <div className="text-[10px] font-medium text-red-500 mt-0.5" title="No AppFolio bill found for this invoice — revenue not yet billed">
                        AF: not billed
                      </div>
                    )}
                  </div>

                  {/* Actions — right-aligned in a consistent-width column regardless of button count */}
                  <div className="flex items-center justify-end gap-1 shrink-0 min-w-[256px]">
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

                    {/* Duplicate — same number with the next -1/-2 suffix, as a new draft */}
                    {onDuplicate && !isVoid && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDuplicate(invoice)}
                        disabled={actionLoading !== null || duplicatingId !== null}
                        title="Duplicate — creates a draft copy with the same number and the next suffix (…-1, …-2)"
                        className="h-8 w-8 p-0"
                      >
                        {duplicatingId === invoice.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 px-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-charcoal-500 hover:text-charcoal-700 text-xs h-8"
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              Prev
            </Button>
            <span className="text-xs text-charcoal-500">
              Page {page} of {totalPages}
              <span className="text-charcoal-300 ml-2">
                ({(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, visible.length)} of {visible.length})
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="text-charcoal-500 hover:text-charcoal-700 text-xs h-8"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        )}
        </>
        )}
      </div>
    </>
  );
}

"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Wrench,
  RefreshCw,
  Search,
  FileText,
  Loader2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  ChevronLeft,
  ChevronRight,
  Plus,
  TrendingUp,
} from "lucide-react";

import { useSearchParams } from "next/navigation";
import { WorkOrderRow, HdmsInvoice } from "@/lib/invoices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CsvUploader } from "./csv-uploader";
import { WorkOrderTable } from "./work-order-table";
import { InvoiceForm } from "./invoice-form";
import { InvoiceList } from "./invoice-list";
import { BillableReport } from "./billable-report";
import { SelectionReport } from "./selection-report";

// ============================================
// Work Order Types (mirrors lib/work-orders.ts)
// ============================================

interface WorkOrder {
  id: string;
  appfolio_id: string;
  property_id: string | null;
  property_name: string;
  property_address: string | null;
  unit_id: string | null;
  unit_name: string | null;
  wo_number: string | null;
  description: string;
  category: string | null;
  priority: string | null;
  status: "open" | "closed" | "done";
  appfolio_status: string | null;
  assigned_to: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  completed_date: string | null;
  canceled_date: string | null;
  permission_to_enter: boolean;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

interface WorkOrderStats {
  total: number;
  open: number;
  closed: number;
  done: number;
}

// ============================================
// Constants
// ============================================

const WO_PAGE_SIZE = 20;

// HDMS vendor — default filter
const HDMS_VENDOR_ID = "ea74594e-0c1f-11f1-ad37-0ec3c4e2b1e7";
const HDMS_VENDOR_LABEL = "HDMS Only";

// Granular AppFolio status styles
const APPFOLIO_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  New: { bg: "bg-sky-100/80", text: "text-sky-700" },
  Assigned: { bg: "bg-blue-100/80", text: "text-blue-700" },
  Scheduled: { bg: "bg-indigo-100/80", text: "text-indigo-700" },
  "Estimate Requested": { bg: "bg-violet-100/80", text: "text-violet-700" },
  Estimated: { bg: "bg-purple-100/80", text: "text-purple-700" },
  Waiting: { bg: "bg-amber-100/80", text: "text-amber-700" },
  "Work Completed": { bg: "bg-teal-100/80", text: "text-teal-700" },
  Completed: { bg: "bg-terra-100/80", text: "text-terra-700" },
  Canceled: { bg: "bg-charcoal-100/80", text: "text-charcoal-500" },
};

const APPFOLIO_STATUSES = [
  "New",
  "Assigned",
  "Estimate Requested",
  "Estimated",
  "Scheduled",
  "Waiting",
  "Work Completed",
  "Completed",
  "Canceled",
];

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  Emergency: { bg: "bg-red-100/80", text: "text-red-700" },
  Urgent: { bg: "bg-red-100/80", text: "text-red-700" },
  High: { bg: "bg-orange-100/80", text: "text-orange-700" },
  Normal: { bg: "bg-charcoal-100/80", text: "text-charcoal-600" },
  Low: { bg: "bg-charcoal-50/80", text: "text-charcoal-400" },
};

// ============================================
// Sort types
// ============================================

type SortField = "property_name" | "status" | "priority" | "created_at" | "completed_date";

// ============================================
// Pill toggle
// ============================================

function PillToggle<T extends string>({
  options,
  selected,
  onToggle,
  labelFn,
}: {
  options: T[];
  selected: T[];
  onToggle: (value: T) => void;
  labelFn?: (value: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const isActive = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-full transition-all duration-200 ${
              isActive
                ? "bg-terra-100/80 text-terra-700 ring-1 ring-terra-300 shadow-sm"
                : "bg-charcoal-50 text-charcoal-500 hover:bg-charcoal-100 hover:text-charcoal-700"
            }`}
          >
            {labelFn ? labelFn(opt) : opt}
          </button>
        );
      })}
    </div>
  );
}

// ============================================
// Main Dashboard
// ============================================

type View = "main" | "table" | "form";
type Tab = "work-orders" | "invoices" | "report";

interface InvoiceDashboardProps {
  userEmail: string;
  userName: string;
}

export function InvoiceDashboard({ userEmail, userName }: InvoiceDashboardProps) {
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>("main");
  const [activeTab, setActiveTab] = useState<Tab>("work-orders");
  const [parsedRows, setParsedRows] = useState<WorkOrderRow[]>([]);
  const [selectedRow, setSelectedRow] = useState<WorkOrderRow | null>(null);
  const [editInvoice, setEditInvoice] = useState<HdmsInvoice | null>(null);
  const [fromPdfScan, setFromPdfScan] = useState(false);
  const [fromWorkOrder, setFromWorkOrder] = useState(false);
  const [invoices, setInvoices] = useState<HdmsInvoice[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(true);
  const [reportInvoices, setReportInvoices] = useState<HdmsInvoice[] | null>(null);

  // Work orders state
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [woStats, setWoStats] = useState<WorkOrderStats | null>(null);
  const [woLoading, setWoLoading] = useState(true);
  const [woSyncing, setWoSyncing] = useState(false);
  const [woSyncMessage, setWoSyncMessage] = useState<string | null>(null);
  const [woAppfolioStatusFilter, setWoAppfolioStatusFilter] = useState<string[]>([]);
  const [woPriorityFilter, setWoPriorityFilter] = useState<string[]>([]);
  const [woVendorFilter, setWoVendorFilter] = useState<string>(HDMS_VENDOR_ID);
  const [woSearchInput, setWoSearchInput] = useState("");
  const [woSearch, setWoSearch] = useState("");
  const [woSortField, setWoSortField] = useState<SortField>("created_at");
  const [woSortDir, setWoSortDir] = useState<"asc" | "desc">("desc");
  const [woPage, setWoPage] = useState(1);

  // ============================================
  // Invoice fetching
  // ============================================

  const fetchInvoices = useCallback(async () => {
    setIsLoadingInvoices(true);
    try {
      const res = await fetch("/api/invoices");
      const data = await res.json();
      if (res.ok) {
        setInvoices(data.invoices);
      }
    } catch (err) {
      console.error("Failed to fetch invoices:", err);
    } finally {
      setIsLoadingInvoices(false);
    }
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  // ============================================
  // Work order fetching
  // ============================================

  const fetchWorkOrders = useCallback(async () => {
    setWoLoading(true);
    try {
      const params = new URLSearchParams();
      if (woAppfolioStatusFilter.length) params.set("appfolio_status", woAppfolioStatusFilter.join(","));
      if (woPriorityFilter.length) params.set("priority", woPriorityFilter.join(","));
      if (woVendorFilter) params.set("vendor_id", woVendorFilter);
      if (woSearch) params.set("search", woSearch);
      const qs = params.toString();
      const res = await fetch(`/api/work-orders${qs ? `?${qs}` : ""}`);
      if (res.ok) {
        const data = await res.json();
        setWorkOrders(data.workOrders || []);
        setWoStats(data.stats || null);
      }
    } catch (err) {
      console.error("Failed to fetch work orders:", err);
    } finally {
      setWoLoading(false);
    }
  }, [woAppfolioStatusFilter, woPriorityFilter, woVendorFilter, woSearch]);

  useEffect(() => {
    fetchWorkOrders();
  }, [fetchWorkOrders]);

  // Reset page when filters change
  useEffect(() => {
    setWoPage(1);
  }, [woAppfolioStatusFilter, woPriorityFilter, woVendorFilter, woSearch]);

  // Search debounce
  useEffect(() => {
    const timeout = setTimeout(() => setWoSearch(woSearchInput || ""), 300);
    return () => clearTimeout(timeout);
  }, [woSearchInput]);

  // ============================================
  // Handle ?from_wo= parameter
  // ============================================

  useEffect(() => {
    const fromWo = searchParams.get("from_wo");
    if (!fromWo) return;

    async function loadWorkOrder(woId: string) {
      try {
        const res = await fetch(`/api/work-orders/${woId}`);
        if (!res.ok) return;
        const data = await res.json();
        const wo = data.workOrder;
        if (!wo) return;

        const row: WorkOrderRow = {
          wo_number: wo.wo_number || wo.appfolio_id || "",
          property_name: wo.property_name || "",
          property_address: wo.property_address || "",
          unit: wo.unit_name || "",
          description: wo.description || "",
          completed_date: wo.completed_date
            ? new Date(wo.completed_date).toISOString().split("T")[0]
            : "",
          category: wo.category || "",
          assigned_to: wo.assigned_to || "",
          work_order_id: wo.id,
        };
        setSelectedRow(row);
        setEditInvoice(null);
        setFromPdfScan(false);
        setFromWorkOrder(true);
        setView("form");
      } catch (err) {
        console.error("Failed to load work order:", err);
      }
    }

    loadWorkOrder(fromWo);
  }, [searchParams]);

  // ============================================
  // Work order sync
  // ============================================

  async function handleWoSync() {
    setWoSyncing(true);
    setWoSyncMessage(null);
    try {
      const res = await fetch("/api/sync/work-orders", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setWoSyncMessage(`Synced ${data.synced} work orders from AppFolio`);
        fetchWorkOrders();
      } else {
        setWoSyncMessage(`Sync error: ${data.error}`);
      }
    } catch {
      setWoSyncMessage("Sync failed — check console");
    } finally {
      setWoSyncing(false);
      setTimeout(() => setWoSyncMessage(null), 5000);
    }
  }

  // ============================================
  // Work order sort + filter helpers
  // ============================================

  function toggle<T extends string>(arr: T[], value: T): T[] {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  }

  const sortedWo = useMemo(() => {
    const arr = [...workOrders];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (woSortField) {
        case "property_name":
          cmp = (a.property_name || "").localeCompare(b.property_name || "");
          break;
        case "status":
          cmp = (a.appfolio_status || "").localeCompare(b.appfolio_status || "");
          break;
        case "priority": {
          const order = { Emergency: 0, Urgent: 1, High: 2, Normal: 3, Low: 4 };
          const aP = order[(a.priority || "Normal") as keyof typeof order] ?? 3;
          const bP = order[(b.priority || "Normal") as keyof typeof order] ?? 3;
          cmp = aP - bP;
          break;
        }
        case "created_at":
          cmp = (a.created_at || "").localeCompare(b.created_at || "");
          break;
        case "completed_date":
          cmp = (a.completed_date || "").localeCompare(b.completed_date || "");
          break;
      }
      return woSortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [workOrders, woSortField, woSortDir]);

  // Pagination
  const totalWoPages = Math.max(1, Math.ceil(sortedWo.length / WO_PAGE_SIZE));
  const paginatedWo = sortedWo.slice((woPage - 1) * WO_PAGE_SIZE, woPage * WO_PAGE_SIZE);

  function handleWoSort(field: SortField) {
    if (woSortField === field) {
      setWoSortDir(woSortDir === "asc" ? "desc" : "asc");
    } else {
      setWoSortField(field);
      setWoSortDir(field === "created_at" ? "desc" : "asc");
    }
  }

  function WoSortIcon({ field }: { field: SortField }) {
    if (woSortField !== field) return <ArrowUpDown className="h-3 w-3 text-charcoal-300" />;
    return woSortDir === "asc" ? (
      <ArrowUp className="h-3 w-3 text-terra-600" />
    ) : (
      <ArrowDown className="h-3 w-3 text-terra-600" />
    );
  }

  // Create invoice from work order
  function handleCreateInvoiceFromWo(wo: WorkOrder) {
    const row: WorkOrderRow = {
      wo_number: wo.wo_number || wo.appfolio_id || "",
      property_name: wo.property_name || "",
      property_address: wo.property_address || "",
      unit: wo.unit_name || "",
      description: wo.description || "",
      completed_date: wo.completed_date
        ? new Date(wo.completed_date).toISOString().split("T")[0]
        : "",
      category: wo.category || "",
      assigned_to: wo.assigned_to || "",
      work_order_id: wo.id,
    };
    setSelectedRow(row);
    setEditInvoice(null);
    setFromPdfScan(false);
    setFromWorkOrder(true);
    setView("form");
  }

  // CSV export
  function handleWoExportCsv() {
    const headers = ["WO #", "Property", "Address", "Description", "Priority", "Status", "Assigned To", "Created", "Completed"];
    const rows = sortedWo.map((wo) => [
      wo.wo_number || wo.appfolio_id,
      wo.property_name,
      wo.property_address || "",
      wo.description,
      wo.priority || "",
      wo.appfolio_status || wo.status,
      wo.assigned_to || "",
      wo.created_at ? new Date(wo.created_at).toLocaleDateString() : "",
      wo.completed_date ? new Date(wo.completed_date).toLocaleDateString() : "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `work-orders-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "\u2014";
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  }

  const woHasFilters = woAppfolioStatusFilter.length > 0 || woPriorityFilter.length > 0 || woVendorFilter !== HDMS_VENDOR_ID || !!woSearch;

  // ============================================
  // CSV / PDF handlers
  // ============================================

  function handleCsvParsed(rows: WorkOrderRow[]) {
    setParsedRows(rows);
    setView("table");
  }

  function handlePdfScanned(fields: Record<string, unknown>) {
    const rawLineItems = Array.isArray(fields.line_items) ? fields.line_items : [];
    const lineItems = rawLineItems.map((li: Record<string, unknown>) => ({
      account: String(li.account || ""),
      description: String(li.description || ""),
      type: (String(li.type || "labor") as "labor" | "materials" | "other"),
      amount: parseFloat(String(li.amount || "0")) || 0,
    }));

    const rawTaskItems = Array.isArray(fields.task_items) ? fields.task_items : [];
    const taskItems = rawTaskItems.map((t: unknown) => String(t)).filter(Boolean);

    const row: WorkOrderRow = {
      wo_number: String(fields.wo_number || ""),
      property_name: String(fields.property_name || ""),
      property_address: String(fields.property_address || ""),
      unit: String(fields.unit || ""),
      description: String(fields.description || ""),
      completed_date: String(fields.completed_date || ""),
      category: String(fields.category || ""),
      assigned_to: String(fields.assigned_to || ""),
      technician: String(fields.technician || ""),
      technician_notes: String(fields.technician_notes || ""),
      status: String(fields.status || ""),
      created_date: String(fields.created_date || ""),
      scheduled_date: String(fields.scheduled_date || ""),
      permission_to_enter: String(fields.permission_to_enter || ""),
      maintenance_limit: String(fields.maintenance_limit || ""),
      pets: String(fields.pets || ""),
      estimate_amount: String(fields.estimate_amount || ""),
      vendor_instructions: String(fields.vendor_instructions || ""),
      property_notes: String(fields.property_notes || ""),
      created_by: String(fields.created_by || ""),
      labor_amount: String(fields.labor_amount || ""),
      materials_amount: String(fields.materials_amount || ""),
      total_amount: String(fields.total_amount || ""),
      task_items: taskItems.length > 0 ? taskItems : undefined,
      line_items: lineItems.length > 0 ? lineItems : undefined,
    };
    setSelectedRow(row);
    setEditInvoice(null);
    setFromPdfScan(true);
    setFromWorkOrder(false);
    setView("form");
  }

  function handleSelectRow(row: WorkOrderRow) {
    setSelectedRow(row);
    setEditInvoice(null);
    setFromPdfScan(false);
    setFromWorkOrder(false);
    setView("form");
  }

  function handleEditInvoice(invoice: HdmsInvoice) {
    setEditInvoice(invoice);
    setSelectedRow(null);
    setActiveTab("invoices");
    setView("form");
  }

  function handleInvoiceSaved() {
    fetchInvoices();
    setActiveTab("invoices");
    setView("main");
    setSelectedRow(null);
    setEditInvoice(null);
    setFromPdfScan(false);
    setFromWorkOrder(false);
  }

  function handleBackToUpload() {
    setView("main");
    setParsedRows([]);
  }

  function handleBackFromForm() {
    fetchInvoices();
    if (editInvoice || fromPdfScan || fromWorkOrder) {
      setView("main");
      setEditInvoice(null);
      setFromPdfScan(false);
      setFromWorkOrder(false);
    } else {
      setView("table");
    }
  }

  // ============================================
  // Render
  // ============================================

  return (
    <div className="max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-charcoal-900 tracking-tight">Maintenance</h1>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleWoSync}
            disabled={woSyncing}
            size="sm"
            className="bg-terra-500 hover:bg-terra-600 text-white shadow-sm transition-all duration-200"
          >
            {woSyncing ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1.5" />
            )}
            {woSyncing ? "Syncing..." : "Sync Now"}
          </Button>
        </div>
      </div>

      {/* Sync message */}
      {woSyncMessage && (
        <div className="bg-white rounded-xl border border-sand-200 shadow-card px-4 py-2.5 text-sm text-terra-700 mb-6">
          {woSyncMessage}
        </div>
      )}

      {/* Main Content */}
      {view === "main" && (
        <div className="space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-3 gap-4">
            {[
              {
                label: "Open",
                value: woStats?.open ?? 0,
                textColor: "text-blue-700",
              },
              {
                label: "Done",
                value: woStats?.done ?? 0,
                textColor: "text-terra-700",
              },
              {
                label: "Closed",
                value: woStats?.closed ?? 0,
                textColor: "text-charcoal-600",
              },
            ].map((card) => (
              <div key={card.label} className="bg-white rounded-xl border border-sand-200 shadow-card p-5">
                {woLoading ? (
                  <div className="animate-pulse space-y-2">
                    <div className="h-3 w-16 bg-charcoal-200 rounded" />
                    <div className="h-8 w-12 bg-charcoal-200 rounded" />
                  </div>
                ) : (
                  <>
                    <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-1">
                      {card.label}
                    </p>
                    <p className={`text-3xl font-bold ${card.textColor}`}>
                      {card.value}
                    </p>
                    <p className="text-[10px] text-charcoal-300 mt-1">
                      of {woStats?.total ?? 0} total
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Tab Bar */}
          <div className="bg-white rounded-xl border border-sand-200 shadow-card px-2 py-1.5 flex gap-1">
            <button
              type="button"
              onClick={() => setActiveTab("work-orders")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === "work-orders"
                  ? "bg-white text-charcoal-900 shadow-sm border border-sand-200"
                  : "text-charcoal-400 hover:text-charcoal-600"
              }`}
            >
              <Wrench className="h-4 w-4" />
              Work Orders
              {!woLoading && (
                <span className={`text-xs font-normal ${activeTab === "work-orders" ? "text-charcoal-500" : "text-charcoal-400"}`}>
                  ({sortedWo.length})
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("invoices")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === "invoices"
                  ? "bg-white text-charcoal-900 shadow-sm border border-sand-200"
                  : "text-charcoal-400 hover:text-charcoal-600"
              }`}
            >
              <FileText className="h-4 w-4" />
              Invoices
              {!isLoadingInvoices && (
                <span className={`text-xs font-normal ${activeTab === "invoices" ? "text-charcoal-500" : "text-charcoal-400"}`}>
                  ({invoices.length})
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("report")}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === "report"
                  ? "bg-white text-charcoal-900 shadow-sm border border-sand-200"
                  : "text-charcoal-400 hover:text-charcoal-600"
              }`}
            >
              <TrendingUp className="h-4 w-4" />
              Report
            </button>
          </div>

          {/* ============================== */}
          {/* Work Orders Tab                */}
          {/* ============================== */}
          {activeTab === "work-orders" && (
            <div className="space-y-6">
              {/* Filters */}
              <div className="bg-white rounded-xl border border-sand-200 shadow-card px-5 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-charcoal-700">Filters</span>
                  {woHasFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setWoAppfolioStatusFilter([]);
                        setWoPriorityFilter([]);
                        setWoVendorFilter(HDMS_VENDOR_ID);
                        setWoSearchInput("");
                      }}
                      className="text-charcoal-400 hover:text-charcoal-600 text-xs"
                    >
                      Reset
                    </Button>
                  )}
                </div>

                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-charcoal-400 uppercase">Vendor:</span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setWoVendorFilter(HDMS_VENDOR_ID)}
                        className={`px-2.5 py-1 text-[10px] font-medium rounded-full transition-all duration-200 ${
                          woVendorFilter === HDMS_VENDOR_ID
                            ? "bg-terra-100/80 text-terra-700 ring-1 ring-terra-300 shadow-sm"
                            : "bg-charcoal-50 text-charcoal-500 hover:bg-charcoal-100 hover:text-charcoal-700"
                        }`}
                      >
                        {HDMS_VENDOR_LABEL}
                      </button>
                      <button
                        type="button"
                        onClick={() => setWoVendorFilter("")}
                        className={`px-2.5 py-1 text-[10px] font-medium rounded-full transition-all duration-200 ${
                          woVendorFilter === ""
                            ? "bg-terra-100/80 text-terra-700 ring-1 ring-terra-300 shadow-sm"
                            : "bg-charcoal-50 text-charcoal-500 hover:bg-charcoal-100 hover:text-charcoal-700"
                        }`}
                      >
                        All Vendors
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-charcoal-400 uppercase">Status:</span>
                    <PillToggle<string>
                      options={APPFOLIO_STATUSES}
                      selected={woAppfolioStatusFilter}
                      onToggle={(s) => setWoAppfolioStatusFilter(toggle(woAppfolioStatusFilter, s))}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-charcoal-400 uppercase">Priority:</span>
                    <PillToggle<string>
                      options={["Emergency", "Urgent", "High", "Normal", "Low"]}
                      selected={woPriorityFilter}
                      onToggle={(p) => setWoPriorityFilter(toggle(woPriorityFilter, p))}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative max-w-xs flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-charcoal-400" />
                    <Input
                      type="text"
                      placeholder="Search property, address, WO#..."
                      value={woSearchInput}
                      onChange={(e) => setWoSearchInput(e.target.value)}
                      className="pl-7 h-8 text-xs bg-white border border-sand-200"
                    />
                  </div>
                </div>
              </div>

              {/* Work Orders Table */}
              <div className="bg-white rounded-xl border border-sand-200 shadow-card overflow-hidden">
                {/* Table header bar */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-sand-200">
                  <span className="text-sm font-semibold text-charcoal-700">
                    {sortedWo.length} Work Order{sortedWo.length !== 1 ? "s" : ""}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleWoExportCsv}
                    disabled={sortedWo.length === 0}
                    className="text-charcoal-400 hover:text-charcoal-600 text-xs"
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    CSV
                  </Button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-charcoal-100/80">
                        <th className="text-left px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider whitespace-nowrap w-[80px]">
                          WO #
                        </th>
                        <th
                          className="text-left px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider cursor-pointer hover:text-charcoal-600"
                          onClick={() => handleWoSort("property_name")}
                        >
                          <span className="inline-flex items-center gap-1">
                            Property <WoSortIcon field="property_name" />
                          </span>
                        </th>
                        <th className="text-left px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider hidden lg:table-cell">
                          Description
                        </th>
                        <th
                          className="text-left px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider cursor-pointer hover:text-charcoal-600"
                          onClick={() => handleWoSort("priority")}
                        >
                          <span className="inline-flex items-center gap-1">
                            Priority <WoSortIcon field="priority" />
                          </span>
                        </th>
                        <th
                          className="text-left px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider cursor-pointer hover:text-charcoal-600"
                          onClick={() => handleWoSort("status")}
                        >
                          <span className="inline-flex items-center gap-1">
                            Status <WoSortIcon field="status" />
                          </span>
                        </th>
                        <th className="text-left px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider hidden md:table-cell">
                          Vendor
                        </th>
                        <th
                          className="text-left px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider cursor-pointer hover:text-charcoal-600 hidden md:table-cell"
                          onClick={() => handleWoSort("created_at")}
                        >
                          <span className="inline-flex items-center gap-1">
                            Created <WoSortIcon field="created_at" />
                          </span>
                        </th>
                        <th className="text-center px-2 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider w-[44px]">
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {woLoading ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-10 text-center">
                            <Loader2 className="h-5 w-5 animate-spin text-terra-500 mx-auto" />
                          </td>
                        </tr>
                      ) : paginatedWo.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-10 text-center text-charcoal-400 text-xs">
                            {woHasFilters
                              ? "No work orders match the current filters"
                              : "No work orders yet \u2014 click Sync Now to pull from AppFolio"}
                          </td>
                        </tr>
                      ) : (
                        paginatedWo.map((wo) => {
                          const afStatus = wo.appfolio_status || "New";
                          const afStyle = APPFOLIO_STATUS_STYLES[afStatus] || { bg: "bg-blue-100/80", text: "text-blue-700" };
                          const priorityStyle = PRIORITY_STYLES[wo.priority || "Normal"] || PRIORITY_STYLES.Normal;

                          return (
                            <tr
                              key={wo.id}
                              className="border-b border-charcoal-50/80 hover:bg-charcoal-50 transition-colors"
                            >
                              <td className="px-4 py-2.5 text-charcoal-600 font-mono text-[11px] whitespace-nowrap">
                                {wo.wo_number || wo.appfolio_id.slice(0, 8)}
                              </td>
                              <td className="px-4 py-2.5">
                                <span className="font-medium text-charcoal-800 text-xs">
                                  {wo.property_name}
                                </span>
                                {wo.property_address && (
                                  <span className="block text-[10px] text-charcoal-400 truncate max-w-[180px]">
                                    {wo.property_address}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-charcoal-500 text-[11px] max-w-[280px] hidden lg:table-cell">
                                <span className="line-clamp-3 leading-relaxed">
                                  {wo.description}
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${priorityStyle.bg} ${priorityStyle.text}`}>
                                  {wo.priority || "Normal"}
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${afStyle.bg} ${afStyle.text}`}>
                                  {afStatus}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-charcoal-500 text-[11px] hidden md:table-cell truncate max-w-[140px]">
                                {wo.vendor_name || "—"}
                              </td>
                              <td className="px-4 py-2.5 text-charcoal-500 text-[11px] hidden md:table-cell">
                                {formatDate(wo.created_at)}
                              </td>
                              <td className="px-2 py-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleCreateInvoiceFromWo(wo)}
                                  title="Create Invoice"
                                  className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-terra-50/80 text-terra-600 hover:bg-terra-100 hover:text-terra-800 transition-colors"
                                >
                                  <Plus className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {!woLoading && sortedWo.length > WO_PAGE_SIZE && (
                  <div className="flex items-center justify-between px-5 py-3 border-t border-sand-200">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setWoPage(Math.max(1, woPage - 1))}
                      disabled={woPage <= 1}
                      className="text-charcoal-500 hover:text-charcoal-700 text-xs h-7"
                    >
                      <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                      Prev
                    </Button>
                    <span className="text-xs text-charcoal-500">
                      Page {woPage} of {totalWoPages}
                      <span className="text-charcoal-300 ml-2">
                        ({(woPage - 1) * WO_PAGE_SIZE + 1}\u2013{Math.min(woPage * WO_PAGE_SIZE, sortedWo.length)} of {sortedWo.length})
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setWoPage(Math.min(totalWoPages, woPage + 1))}
                      disabled={woPage >= totalWoPages}
                      className="text-charcoal-500 hover:text-charcoal-700 text-xs h-7"
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </div>
                )}

                {/* Footer */}
                {!woLoading && sortedWo.length > 0 && (
                  <div className="px-5 py-2.5 text-center text-[10px] text-charcoal-300 border-t border-sand-200">
                    Last synced{" "}
                    {workOrders[0]?.synced_at ? formatDate(workOrders[0].synced_at) : "never"}
                  </div>
                )}
              </div>

              {/* File Drop Zone — below work orders table */}
              <CsvUploader onParsed={handleCsvParsed} onPdfScanned={handlePdfScanned} />
            </div>
          )}

          {/* ============================== */}
          {/* Invoices Tab                   */}
          {/* ============================== */}
          {activeTab === "invoices" && (
            <>
              <div className="bg-white rounded-xl border border-sand-200 shadow-card px-4 py-2.5 text-sm text-charcoal-600 mb-4">
                These invoice PDFs are generated and stored here in HDPM-OS. They are
                <strong> not</strong> pushed to AppFolio automatically — download each PDF and
                upload it to the AppFolio work order yourself, then mark it attached.
              </div>
              <InvoiceList
                invoices={invoices}
                onRefresh={fetchInvoices}
                onEdit={handleEditInvoice}
                onRunReport={setReportInvoices}
                isLoading={isLoadingInvoices}
              />
            </>
          )}

          {/* ============================== */}
          {/* Report Tab                     */}
          {/* ============================== */}
          {activeTab === "report" && <BillableReport />}
        </div>
      )}

      {view === "table" && (
        <WorkOrderTable
          rows={parsedRows}
          onSelectRow={handleSelectRow}
          onBack={handleBackToUpload}
        />
      )}

      {view === "form" && (
        <InvoiceForm
          workOrder={selectedRow}
          editInvoice={editInvoice}
          onBack={handleBackFromForm}
          onSaved={handleInvoiceSaved}
        />
      )}

      {/* Selection markup report (modal over the Invoices tab) */}
      {reportInvoices && (
        <SelectionReport
          invoices={reportInvoices}
          onClose={() => setReportInvoices(null)}
        />
      )}
    </div>
  );
}

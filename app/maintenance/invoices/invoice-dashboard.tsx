"use client";
import { canAuthorEstimates } from '@/lib/turn-estimator/access';

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
  Wallet,
} from "lucide-react";

import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { SkeletonRows } from "@/components/ui/skeleton";
import DailyBillingReview from "../daily-billing/review";
import { dailyBillingAccess } from "@/lib/daily-billing/access";
import { canCreateInvoices, canIssueInvoices, canPrepareFieldInvoices } from "@/lib/invoice-permissions";
import { useSession } from "next-auth/react";
import { WorkOrderRow, HdmsInvoice, displayAssignee, TECHNICIANS, weeklyBillableHours, WEEKLY_HOURS_TARGET } from "@/lib/invoices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CsvUploader } from "./csv-uploader";
import { WorkOrderTable } from "./work-order-table";
import { WorkspaceInvoice } from "./workspace-invoice";
import { InvoiceForm } from "./invoice-form";
import type { EstimateQueueItem } from "@/lib/turn-estimator/estimate-queue";
import { EstimatesTab } from "./estimates-tab";
import { InvoiceList } from "./invoice-list";
import { CreditForm } from "./credit-form";
import { BillableReport } from "./billable-report";
import { DailyReport } from "./daily-report";
import { InhouseReport } from "./inhouse-report";
import { HdmsReconReport } from "./hdms-recon-report";
import { SelectionReport } from "./selection-report";
import { ReconcileTab } from "./reconcile-tab";
import { PaymentReconcileModal } from "./payment-reconcile-modal";

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

type SortField = "property_name" | "status" | "priority" | "assigned_to" | "created_at" | "completed_date";

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
type Tab = "work-orders" | "estimates" | "invoices" | "report" | "reconcile";

interface InvoiceDashboardProps {
  userEmail: string;
  userName: string;
}

export function InvoiceDashboard({ userEmail, userName }: InvoiceDashboardProps) {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  // Profit/markup reports (selection report, daily labor & markup) are gated
  // to the ADMIN_EMAILS allowlist — same gate as the KPI dashboard.
  const isAdmin = session?.user?.isAdmin === true;
  const canReviewBilling = dailyBillingAccess(session?.user?.role || "read_only", session?.user?.email || "").office;
  const [newInvoiceType, setNewInvoiceType] = useState<"labor" | "appliance" | null>(null);
  const canCreate = canCreateInvoices(session?.user?.role, session?.user?.email);
  const fieldInvoiceFlow = canPrepareFieldInvoices(session?.user?.role, session?.user?.email);
  const [view, setView] = useState<View>("main");
  const [activeTab, setActiveTab] = useState<Tab>("work-orders");
  function changeTab(tab: Tab) {
    setActiveTab(tab);
    window.history.replaceState(null, '', `/maintenance/invoices?tab=${tab}`);
  }
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && ['work-orders','estimates','invoices','report','reconcile'].includes(tab)) setActiveTab(tab as Tab);
  }, [searchParams]);
  const [workOrderEstimates, setWorkOrderEstimates] = useState<EstimateQueueItem[]>([]);
  useEffect(() => {
    if (activeTab !== 'work-orders') return;
    let cancelled = false;
    fetch('/api/turn-estimator/estimate-queue').then(r => r.ok ? r.json() : null).then(data => {
      if (!cancelled && data) setWorkOrderEstimates(data.estimates);
    }).catch(() => { /* Estimates tab provides the retry UI if unavailable. */ });
    return () => { cancelled = true; };
  }, [activeTab]);
  const [reportView, setReportView] = useState<"billing-review" | "billable" | "daily" | "inhouse" | "hdms-recon">("billing-review");
  const [parsedRows, setParsedRows] = useState<WorkOrderRow[]>([]);
  const [selectedRow, setSelectedRow] = useState<WorkOrderRow | null>(null);
  const [editInvoice, setEditInvoice] = useState<HdmsInvoice | null>(null);
  const [fromPdfScan, setFromPdfScan] = useState(false);
  const [fromWorkOrder, setFromWorkOrder] = useState(false);
  const [invoices, setInvoices] = useState<HdmsInvoice[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(true);
  const [reportInvoices, setReportInvoices] = useState<HdmsInvoice[] | null>(null);
  const [reconcileInvoices, setReconcileInvoices] = useState<HdmsInvoice[] | null>(null);
  const [paymentsReloadToken, setPaymentsReloadToken] = useState(0);
  // Bumped when a payment is recorded, so the reconcile list clears its saved selection.
  const [reconcileClearToken, setReconcileClearToken] = useState(0);
  const [showCreditForm, setShowCreditForm] = useState(false);

  // Work orders state
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [woStats, setWoStats] = useState<WorkOrderStats | null>(null);
  const [woLoading, setWoLoading] = useState(true);
  const [woSyncing, setWoSyncing] = useState(false);
  const [woSyncMessage, setWoSyncMessage] = useState<string | null>(null);
  const [woAppfolioStatusFilter, setWoAppfolioStatusFilter] = useState<string[]>([]);
  const [woPriorityFilter, setWoPriorityFilter] = useState<string[]>([]);
  const [woTechFilter, setWoTechFilter] = useState<string[]>([]);
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
      // Pull the full set (API caps at 5000); the list paginates client-side.
      const res = await fetch("/api/invoices?limit=5000");
      const data = await res.json();
      if (res.ok) {
        setInvoices(data.invoices);
      }
    } catch (err) {
      console.error("Failed to fetch invoices:", err);
      toast.error("Could not load invoices — check your connection and retry.");
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
      toast.error("Could not load work orders — check your connection and retry.");
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
  }, [woAppfolioStatusFilter, woPriorityFilter, woTechFilter, woVendorFilter, woSearch]);

  // Search debounce
  useEffect(() => {
    const timeout = setTimeout(() => setWoSearch(woSearchInput || ""), 300);
    return () => clearTimeout(timeout);
  }, [woSearchInput]);

  // ============================================
  // Handle ?from_wo= parameter
  // ============================================

  useEffect(() => {
    const invoiceId=searchParams.get("invoice");
    if(invoiceId){fetch(`/api/invoices/${invoiceId}`).then(r=>r.json()).then(d=>{if(d.invoice){setEditInvoice(d.invoice);setView("form");setFromWorkOrder(false);}}).catch(()=>toast.error("Could not open invoice"));return;}
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
        toast.error("Could not open that work order.");
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

  // This week's billed labor hours vs the 30–36 target band.
  const weeklyHours = useMemo(() => weeklyBillableHours(invoices), [invoices]);

  // Staff names present in the loaded work orders, known technicians first.
  const woTechOptions = useMemo(() => {
    const names = new Set<string>();
    for (const wo of workOrders) {
      const t = displayAssignee(wo.assigned_to);
      if (t) names.add(t);
    }
    const known = TECHNICIANS.filter((t) => names.has(t));
    const rest = [...names].filter((n) => !(TECHNICIANS as readonly string[]).includes(n)).sort();
    return [...known, ...rest, "Unassigned"];
  }, [workOrders]);

  const sortedWo = useMemo(() => {
    // Assigned-tech filter is client-side (multi-select, empty = all).
    const arr = woTechFilter.length
      ? workOrders.filter((wo) =>
          woTechFilter.includes(displayAssignee(wo.assigned_to) ?? "Unassigned")
        )
      : [...workOrders];
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
        case "assigned_to": {
          const aT = displayAssignee(a.assigned_to);
          const bT = displayAssignee(b.assigned_to);
          // Unassigned sorts last regardless of direction.
          if (!aT && !bT) cmp = 0;
          else if (!aT) return 1;
          else if (!bT) return -1;
          else cmp = aT.localeCompare(bT);
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
  }, [workOrders, woTechFilter, woSortField, woSortDir]);

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

  function handleNewInvoice(type: "labor" | "appliance") {
    setNewInvoiceType(type);
    setSelectedRow(null);
    setEditInvoice(null);
    setFromPdfScan(false);
    setFromWorkOrder(false);
    changeTab("invoices");
    setView("form");
  }

  // Create invoice from work order
  function handleCreateInvoiceFromWo(wo: WorkOrder) {
    setNewInvoiceType(null);
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
      displayAssignee(wo.assigned_to) || "",
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

  const woHasFilters = woAppfolioStatusFilter.length > 0 || woPriorityFilter.length > 0 || woTechFilter.length > 0 || woVendorFilter !== HDMS_VENDOR_ID || !!woSearch;

  // ============================================
  // CSV / PDF handlers
  // ============================================

  function handleCsvParsed(rows: WorkOrderRow[]) {
    setParsedRows(rows);
    setView("table");
  }

  function handlePdfScanned(fields: Record<string, unknown>) {
    setNewInvoiceType(null);
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
    setNewInvoiceType(null);
    setSelectedRow(row);
    setEditInvoice(null);
    setFromPdfScan(false);
    setFromWorkOrder(false);
    setView("form");
  }

  function handleEditInvoice(invoice: HdmsInvoice) {
    setNewInvoiceType(null);
    setEditInvoice(invoice);
    setSelectedRow(null);
    changeTab("invoices");
    setView("form");
  }

  // Duplicate: create a draft copy (same number + next suffix) then open it in
  // the editor so the user can adjust and save.
  async function handleDuplicateInvoice(invoice: HdmsInvoice) {
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/duplicate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to duplicate invoice");
      toast.success(`Created ${data.invoice.invoice_code} — edit and save when ready.`);
      await fetchInvoices();
      handleEditInvoice(data.invoice as HdmsInvoice);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not duplicate that invoice.");
    }
  }

  function handleInvoiceSaved() {
    setNewInvoiceType(null);
    fetchInvoices();
    changeTab("invoices");
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
    changeTab(editInvoice ? "invoices" : activeTab);
    fetchInvoices();
    if (editInvoice || fromPdfScan || fromWorkOrder || newInvoiceType) {
      setNewInvoiceType(null);
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
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm"><p className="text-charcoal-500">Scope → approval → completed work → billing</p><div className="flex flex-wrap gap-4"><a href="/turn-estimator/price-book" className="font-medium text-green-800 underline">Price book</a><a href="/maintenance/workspace?view=schedule" className="font-medium text-green-800 underline">Availability & planned revenue →</a></div></div>
      {/* Page Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-charcoal-900 tracking-tight">Work &amp; Billing</h1>
          <p className="mt-1 text-sm text-charcoal-500">Work orders, estimates, and invoices in one place.</p>
        </div>

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
          {/* Tab Bar */}
          <div className="bg-white rounded-xl border border-sand-200 shadow-card px-2 py-1.5 flex gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => changeTab("work-orders")}
              className={`flex-1 flex items-center justify-center gap-2 whitespace-nowrap px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
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
            <button type="button" onClick={() => changeTab("estimates")} aria-current={activeTab === 'estimates' ? 'page' : undefined}
              className={`flex-1 flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold ${activeTab === 'estimates' ? 'bg-white text-charcoal-900 shadow-sm border border-sand-200' : 'text-charcoal-400 hover:text-charcoal-600'}`}>
              <FileText className="h-4 w-4"/>Estimates
            </button>
            <button
              type="button"
              onClick={() => changeTab("invoices")}
              className={`flex-1 flex items-center justify-center gap-2 whitespace-nowrap px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
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
            {/* Billing review is available to office staff; payroll/profit reports stay admin-only. */}
            {canReviewBilling && (
              <button
                type="button"
                onClick={() => changeTab("report")}
                className={`flex-1 flex items-center justify-center gap-2 whitespace-nowrap px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                  activeTab === "report"
                    ? "bg-white text-charcoal-900 shadow-sm border border-sand-200"
                    : "text-charcoal-400 hover:text-charcoal-600"
                }`}
              >
                <TrendingUp className="h-4 w-4" />
                Reports
              </button>
            )}
            <button
              type="button"
              onClick={() => changeTab("reconcile")}
              className={`flex-1 flex items-center justify-center gap-2 whitespace-nowrap px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === "reconcile"
                  ? "bg-white text-charcoal-900 shadow-sm border border-sand-200"
                  : "text-charcoal-400 hover:text-charcoal-600"
              }`}
            >
              <Wallet className="h-4 w-4" />
              Reconcile
            </button>
          </div>

          {activeTab === 'estimates' && <EstimatesTab onChooseWorkOrder={() => changeTab('work-orders')}/>}

          {/* ============================== */}
          {/* Work Orders Tab                */}
          {/* ============================== */}
          {activeTab === "work-orders" && (
            <div className="space-y-6">
              {/* Work-order statistics belong with the work-order list. */}
          {activeTab === "work-orders" && <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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

            {/* Billable hours this week vs the 30–36 target band */}
            <div className="bg-white rounded-xl border border-sand-200 shadow-card p-5">
              {isLoadingInvoices ? (
                <div className="animate-pulse space-y-2">
                  <div className="h-3 w-16 bg-charcoal-200 rounded" />
                  <div className="h-8 w-12 bg-charcoal-200 rounded" />
                </div>
              ) : (
                <>
                  <p className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider mb-1">
                    Billed Hrs (wk)
                  </p>
                  <div className="flex items-baseline gap-4">
                    {TECHNICIANS.map((tech) => {
                      const hrs = weeklyHours.byTech[tech] ?? 0;
                      const color =
                        hrs >= WEEKLY_HOURS_TARGET.min && hrs <= WEEKLY_HOURS_TARGET.max
                          ? "text-green-700"
                          : hrs > WEEKLY_HOURS_TARGET.max
                            ? "text-amber-600"
                            : "text-charcoal-600";
                      return (
                        <div key={tech}>
                          <span className={`text-3xl font-bold ${color}`}>{hrs}</span>
                          <span className="ml-1 text-[10px] font-semibold text-charcoal-400 uppercase">
                            {tech}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-charcoal-300 mt-1">
                    target {WEEKLY_HOURS_TARGET.min}–{WEEKLY_HOURS_TARGET.max} each · last wk{" "}
                    {TECHNICIANS.map((t) => weeklyHours.lastWeekByTech[t] ?? 0).join(" / ")}
                  </p>
                </>
              )}
            </div>
          </div>}
              <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-900"><strong>Create an invoice from a work order.</strong> Choose <strong>Create invoice</strong> to fill in the property, work-order details, and labor description. Review the hours, materials, and charges before saving.</div>
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
                        setWoTechFilter([]);
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
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium text-charcoal-400 uppercase">Assigned:</span>
                    <PillToggle<string>
                      options={woTechOptions}
                      selected={woTechFilter}
                      onToggle={(t) => setWoTechFilter(toggle(woTechFilter, t))}
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
                        <th className="sticky left-0 z-10 bg-white text-center px-2 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider whitespace-nowrap border-r border-charcoal-100/80">
                          Actions
                        </th>
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
                        <th
                          className="text-left px-4 py-2 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider cursor-pointer hover:text-charcoal-600"
                          onClick={() => handleWoSort("assigned_to")}
                        >
                          <span className="inline-flex items-center gap-1">
                            Assigned <WoSortIcon field="assigned_to" />
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
                      </tr>
                    </thead>
                    <tbody>
                      {woLoading ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-4">
                            <SkeletonRows rows={6} />
                          </td>
                        </tr>
                      ) : paginatedWo.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-10 text-center text-charcoal-400 text-xs">
                            {woHasFilters
                              ? "No work orders match the current filters"
                              : "No work orders yet \u2014 click Sync Now to pull from AppFolio"}
                          </td>
                        </tr>
                      ) : (
                        paginatedWo.map((wo) => {
                          const existingEstimate = workOrderEstimates.find(e => e.workOrderId === wo.id && e.stage !== 'closed');
                          const afStatus = wo.appfolio_status || "New";
                          const afStyle = APPFOLIO_STATUS_STYLES[afStatus] || { bg: "bg-blue-100/80", text: "text-blue-700" };
                          const priorityStyle = PRIORITY_STYLES[wo.priority || "Normal"] || PRIORITY_STYLES.Normal;

                          return (
                            <tr
                              key={wo.id}
                              className="group border-b border-charcoal-50/80 hover:bg-charcoal-50 transition-colors"
                            >
                              <td className="sticky left-0 bg-white group-hover:bg-charcoal-50 border-r border-charcoal-100/80 px-2 py-2.5 text-center transition-colors">
                                <div className="flex flex-col items-stretch gap-1.5">
                                  {canCreate && <button type="button" onClick={() => handleCreateInvoiceFromWo(wo)} className="inline-flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-terra-600 px-3 py-2 text-xs font-semibold text-white hover:bg-terra-700" title="Create an invoice prefilled from this work order"><Plus className="h-3.5 w-3.5"/>Create invoice</button>}
                                  {canAuthorEstimates(session?.user?.role, session?.user?.email) && <>
                                  <a href={existingEstimate?.href || `/turn-estimator/estimates/new?from_wo=${wo.id}`} className="inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-green-700 px-3 py-2 text-xs font-medium text-white hover:bg-green-800"><FileText className="h-3.5 w-3.5"/>{existingEstimate ? (existingEstimate.stage === "draft" ? "Continue estimate" : "View estimate") : "Create estimate"}</a>
                                  {!fieldInvoiceFlow && <a href={existingEstimate?.stage==='approved'?`/maintenance/workspace?estimate=${existingEstimate.id}&schedule=1`:`/maintenance/workspace?work_order=${wo.id}&schedule=1`} className="min-h-9 rounded-lg border border-sand-200 px-2 py-1.5 text-xs text-green-800">Schedule</a>}
                                  </>}
                                </div>
                              </td>
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
                              <td className="px-4 py-2.5 text-charcoal-600 text-[11px] font-medium whitespace-nowrap">
                                {displayAssignee(wo.assigned_to) || <span className="text-charcoal-300 font-normal">—</span>}
                              </td>
                              <td className="px-4 py-2.5 text-charcoal-500 text-[11px] hidden md:table-cell truncate max-w-[140px]">
                                {wo.vendor_name || "—"}
                              </td>
                              <td className="px-4 py-2.5 text-charcoal-500 text-[11px] hidden md:table-cell">
                                {formatDate(wo.created_at)}
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
              {canCreate && <div className="mb-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => handleNewInvoice("appliance")} className="rounded-lg bg-green-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-800">+ New appliance invoice</button>
                <button type="button" onClick={() => handleNewInvoice("labor")} className="rounded-lg border border-sand-300 px-4 py-2.5 text-sm">+ New invoice</button>
                <p className="text-sm text-charcoal-500">Bill an appliance purchase for a property. Enter cost and quantity; the standard 10% appliance markup is prefilled.</p>
              </div>}
              <div className="flex items-start gap-3 mb-4">
                <div className="flex-1 bg-white rounded-xl border border-sand-200 shadow-card px-4 py-2.5 text-sm text-charcoal-600">
                  These invoice PDFs are generated and stored here in HDPM-OS. They are
                  <strong> not</strong> pushed to AppFolio automatically — download each PDF and
                  upload it to the AppFolio work order yourself, then mark it attached.
                </div>
                {canIssueInvoices(session?.user?.role) && <button
                  type="button"
                  onClick={() => setShowCreditForm(true)}
                  className="shrink-0 h-10 px-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 transition-colors"
                  title="Create a credit memo to correct an over-billed or duplicate invoice"
                >
                  + New credit
                </button>}
              </div>
              <InvoiceList
                invoices={invoices}
                onRefresh={fetchInvoices}
                onEdit={handleEditInvoice}
                onDuplicate={handleDuplicateInvoice}
                onRunReport={isAdmin ? setReportInvoices : undefined}
                onReconcile={setReconcileInvoices}
                isLoading={isLoadingInvoices}
              />
            </>
          )}

          {/* ============================== */}
          {/* Report Tab                     */}
          {/* ============================== */}
          {activeTab === "report" && canReviewBilling && (
            <div className="space-y-4">
              <div className="inline-flex rounded-lg border border-sand-200 overflow-hidden">
                  {(
                    [
                      { id: "billing-review", label: "Daily Billing Review" },
                      { id: "billable", label: "Billable" },
                      { id: "daily", label: "Daily Labor & Markup" },
                      { id: "inhouse", label: "In-house vs Vendor" },
                      { id: "hdms-recon", label: "Billing Recon" },
                    ] as const
                  ).filter(v => isAdmin || v.id === "billing-review").map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setReportView(v.id)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        reportView === v.id
                          ? "bg-terra-500 text-white"
                          : "bg-white text-charcoal-500 hover:text-charcoal-700"
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
              </div>
              {!isAdmin || reportView === "billing-review" ? (
                <DailyBillingReview embedded />
              ) : reportView === "daily" ? (
                <DailyReport />
              ) : reportView === "inhouse" ? (
                <InhouseReport />
              ) : reportView === "hdms-recon" ? (
                <HdmsReconReport />
              ) : (
                <BillableReport />
              )}
            </div>
          )}

          {/* ============================== */}
          {/* Reconcile Tab                  */}
          {/* ============================== */}
          {activeTab === "reconcile" && (
            <ReconcileTab
              invoices={invoices}
              isLoadingInvoices={isLoadingInvoices}
              onRefreshInvoices={fetchInvoices}
              onEdit={handleEditInvoice}
              onReconcile={setReconcileInvoices}
              reloadToken={paymentsReloadToken}
              clearSelectionToken={reconcileClearToken}
            />
          )}
        </div>
      )}

      {view === "table" && (
        <WorkOrderTable
          rows={parsedRows}
          onSelectRow={handleSelectRow}
          onBack={handleBackToUpload}
        />
      )}

      {view === "form" && fromWorkOrder && !editInvoice && <div className="mb-5 rounded-xl border border-sand-200 bg-white p-4 text-sm text-charcoal-600"><strong>Invoice from work order {selectedRow?.wo_number}.</strong> The work-order details and labor description are filled in below. Confirm the work performed, enter the actual labor hours, and review materials and charges before saving.</div>}
      {view === "form" && (editInvoice?.maintenance_job_id ? <WorkspaceInvoice invoice={editInvoice} onBack={handleBackFromForm} onSaved={handleInvoiceSaved}/> :
        <InvoiceForm
          initialLineType={newInvoiceType ?? "labor"}
          workOrder={selectedRow}
          editInvoice={editInvoice}
          onBack={handleBackFromForm}
          onSaved={handleInvoiceSaved}
        />
      )}

      {/* New credit memo (modal) */}
      {showCreditForm && (
        <CreditForm
          invoices={invoices}
          onClose={() => setShowCreditForm(false)}
          onCreated={fetchInvoices}
        />
      )}

      {/* Selection markup report (modal over the Invoices tab — admin only) */}
      {isAdmin && reportInvoices && (
        <SelectionReport
          invoices={reportInvoices}
          onClose={() => setReportInvoices(null)}
        />
      )}

      {/* Payment reconciliation (modal) */}
      {reconcileInvoices && (
        <PaymentReconcileModal
          invoices={reconcileInvoices}
          onClose={() => setReconcileInvoices(null)}
          onRecorded={() => {
            fetchInvoices();
            setPaymentsReloadToken((t) => t + 1);
            setReconcileClearToken((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}

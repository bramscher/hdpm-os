"use client";

import { useSession } from "next-auth/react";
import { canEditInvoiceDraft, canCreateInvoices, canGenerateInvoice } from "@/lib/invoice-permissions";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { ArrowLeft, Save, FileDown, Loader2, Trash2, Wrench, Package, Check, Clock, Refrigerator } from "lucide-react";
import { Button } from "@/components/ui/button";
import ImproveWithAI from "@/components/ImproveWithAI";
import { Input } from "@/components/ui/input";
import {
  WorkOrderRow,
  HdmsInvoice,
  LineItem,
  TECHNICIANS,
  normalizeTechnician,
  DEFAULT_MARKUP_PCT,
  chargedFromCost,
} from "@/lib/invoices";

import type { PriceBookItem } from "@/lib/turn-estimator/types";
import { needsPriceReview, priceBookName, priceBookRate } from "@/lib/turn-estimator/price-book-display";
import { chargeProblems, TENANT_REASON_LABEL, type ChargeTo, type TenantChargeReason } from "@/lib/invoice-charge";

interface InvoiceFormProps {
  initialLineType?: "labor" | "appliance";
  workOrder: WorkOrderRow | null;
  editInvoice: HdmsInvoice | null;
  onBack: () => void;
  onSaved: (invoice: HdmsInvoice) => void;
}

type LineItemType = "labor" | "materials" | "other" | "appliance";
type RateType = "standard" | "after-hours";

/** Materials-style lines that carry a cost basis and get marked up. */
function isMaterialType(t: LineItemType): boolean {
  return t === "materials" || t === "appliance";
}

/** The effective markup % string for a line, falling back to the type default. */
function effMarkup(li: FormLineItem): string {
  if (li.markupPct != null && li.markupPct !== "") return li.markupPct;
  return li.type === "appliance"
    ? String(DEFAULT_MARKUP_PCT.appliance)
    : String(DEFAULT_MARKUP_PCT.materials);
}

// ── Labor rate constants ──────────
const STANDARD_RATE = 95;
const AFTER_HOURS_MULTIPLIER = 1.5;
const AFTER_HOURS_RATE = STANDARD_RATE * AFTER_HOURS_MULTIPLIER; // $142.50

// ── Flat fee jobs lookup (user will populate) ──────────
const FLAT_FEE_JOBS: { key: string; label: string; amount: number; description: string }[] = [
  // Examples — user will provide actual list:
  // { key: "winterize", label: "Winterize Sprinklers", amount: 75, description: "Winterize sprinkler system — blow out lines" },
  // { key: "swamp-startup", label: "Swamp Cooler Startup", amount: 125, description: "Seasonal swamp cooler startup and inspection" },
];

interface FormLineItem {
  id: string;
  type: LineItemType;
  account: string;
  description: string;
  amount: string;
  // Labor-specific
  qty: string;
  rate: string;
  rateType: RateType;
  technician?: string; // "Brody" | "Alberto" — attributes labor to a tech (labor lines only)
  // Materials / appliance-specific (internal only — never printed on the PDF)
  cost?: string;       // what HDMS paid for this line
  markupPct?: string;  // markup % applied on top of cost (defaults: 25 materials / 10 appliance)
  // Materials-specific
  flatFeeKey: string;
}

let nextLineItemId = 1;
function newLineItemId(): string {
  return `li_${nextLineItemId++}`;
}

function blankLineItem(type: LineItemType = "labor", technician = ""): FormLineItem {
  return {
    id: newLineItemId(),
    type,
    account: "",
    description: "",
    amount: "0.00",
    // Materials/appliance count defaults to 1 so charged = cost-each × markup right away.
    qty: isMaterialType(type) ? "1" : "",
    rate: type === "labor" ? STANDARD_RATE.toFixed(2) : "",
    rateType: "standard",
    technician: type === "labor" ? technician : "",
    cost: "",
    markupPct: type === "appliance"
      ? String(DEFAULT_MARKUP_PCT.appliance)
      : type === "materials"
        ? String(DEFAULT_MARKUP_PCT.materials)
        : "",
    flatFeeKey: "",
  };
}

const TYPE_STYLES: Record<LineItemType, { bg: string; text: string; label: string; icon: typeof Wrench }> = {
  labor: { bg: "bg-blue-50", text: "text-blue-700", label: "Labor", icon: Wrench },
  materials: { bg: "bg-amber-50", text: "text-amber-700", label: "Materials", icon: Package },
  appliance: { bg: "bg-orange-50", text: "text-orange-700", label: "Appliance", icon: Refrigerator },
  other: { bg: "bg-charcoal-50", text: "text-charcoal-600", label: "Other", icon: Wrench },
};


type ChargeState = {
  charge_to: ChargeTo;
  tenant_name: string;
  tenant_unit: string;
  tenant_charge_reason: TenantChargeReason | "";
  tenant_charge_note: string;
  lease_clause: string;
};
const OWNER_CHARGE: ChargeState = { charge_to: "owner", tenant_name: "", tenant_unit: "", tenant_charge_reason: "", tenant_charge_note: "", lease_clause: "" };
/** Payer fields for the API; an owner charge sends no tenant details. */
function chargePayload(c: ChargeState) {
  const v = (x: string) => (c.charge_to === "tenant" && x.trim() ? x.trim() : null);
  return {
    charge_to: c.charge_to,
    tenant_name: v(c.tenant_name),
    tenant_unit: v(c.tenant_unit),
    tenant_charge_reason: c.charge_to === "tenant" && c.tenant_charge_reason ? c.tenant_charge_reason : null,
    tenant_charge_note: v(c.tenant_charge_note),
    lease_clause: v(c.lease_clause),
  };
}

export function InvoiceForm({ initialLineType = "labor", workOrder, editInvoice, onBack, onSaved }: InvoiceFormProps) {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canIssue = canGenerateInvoice(role, session?.user?.email, editInvoice, session?.user?.capabilities);
  const canEdit = editInvoice ? canEditInvoiceDraft(role, session?.user?.email, editInvoice, session?.user?.capabilities) : canCreateInvoices(role, session?.user?.email, session?.user?.capabilities);
  // Header fields
  const [propertyName, setPropertyName] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [woReference, setWoReference] = useState("");
  const [completedDate, setCompletedDate] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  // Who pays: an Owner charge or a Tenant charge, never both.
  const [charge, setCharge] = useState<ChargeState>(OWNER_CHARGE);
  const chargeLocked = !!editInvoice && (editInvoice.status === "attached" || !!editInvoice.tenant_ledger_posted_at);
  const updateCharge = (patch: Partial<ChargeState>) => { userHasEdited.current = true; setCharge((c) => ({ ...c, ...patch })); };

  // Tenant charge: prefill tenant name + unit from AppFolio (nightly sync) so the tech doesn't have to know them.
  type TenantMatch = { tenantName: string; unit: string; address: string; syncedAt: string | null };
  const [tenantMatches, setTenantMatches] = useState<TenantMatch[] | null>(null);
  const [tenantLookupBusy, setTenantLookupBusy] = useState(false);
  const tenantLookupKey = useRef<string | null>(null);
  useEffect(() => {
    if (charge.charge_to !== "tenant" || chargeLocked || charge.tenant_name.trim() || !propertyAddress.trim()) return;
    const key = `${propertyAddress}|${charge.tenant_unit}`;
    if (tenantLookupKey.current === key) return;
    tenantLookupKey.current = key;
    setTenantLookupBusy(true);
    fetch(`/api/invoices/tenant-lookup?address=${encodeURIComponent(propertyAddress)}&unit=${encodeURIComponent(charge.tenant_unit)}`)
      .then((r) => (r.ok ? r.json() : { matches: [] }))
      .then((data: { matches?: TenantMatch[] }) => {
        const matches = data.matches ?? [];
        setTenantMatches(matches);
        if (matches.length === 1) {
          setCharge((c) => (c.tenant_name.trim() ? c : { ...c, tenant_name: matches[0].tenantName, tenant_unit: c.tenant_unit.trim() || matches[0].unit }));
        }
      })
      .catch(() => setTenantMatches([]))
      .finally(() => setTenantLookupBusy(false));
  }, [charge.charge_to, charge.tenant_name, charge.tenant_unit, chargeLocked, propertyAddress]);

  // Line items
  const [lineItems, setLineItems] = useState<FormLineItem[]>([blankLineItem(initialLineType)]);

  // Scanned extra fields (read-only context shown to user)
  const [scannedMeta, setScannedMeta] = useState<{
    technician?: string;
    technicianNotes?: string;
    status?: string;
    createdDate?: string;
    scheduledDate?: string;
    permissionToEnter?: string;
    maintenanceLimit?: string;
    pets?: string;
    estimateAmount?: string;
    vendorInstructions?: string;
    propertyNotes?: string;
    createdBy?: string;
  }>({});

  const [taskItems, setTaskItems] = useState<string[]>([]);
  const [hourlyItem, setHourlyItem] = useState<PriceBookItem | null>(null);
  const [priceBookError, setPriceBookError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/turn-estimator/price-book', {signal: controller.signal})
      .then(async res => { if (!res.ok) throw new Error('Price book unavailable'); return res.json(); })
      .then(data => {
        const item = (data.items as PriceBookItem[]).find(i => i.item_code === 'LABOR_STD' && i.pricing_method === 'hourly' && !needsPriceReview(i));
        setHourlyItem(item ?? null);
        if (!item) setPriceBookError('No approved standard hourly labor item is available. Use + Labor to enter an approved rate manually.');
      })
      .catch(err => { if (err.name !== 'AbortError') setPriceBookError('Price book unavailable. Use + Labor to enter an approved rate manually.'); });
    return () => controller.abort();
  }, []);


  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTechNotes, setShowTechNotes] = useState(false);
  const [showTaskList, setShowTaskList] = useState(false);

  const [extractingMaterials, setExtractingMaterials] = useState(false);

  // Auto-save state
  const userHasEdited = useRef(false);
  const savedInvoiceIdRef = useRef<string | null>(editInvoice?.id ?? null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "unsaved" | "saving" | "saved">("idle");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const isSavingRef = useRef(false);
  const isGeneratingRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => { isSavingRef.current = isSaving; }, [isSaving]);
  useEffect(() => { isGeneratingRef.current = isGenerating; }, [isGenerating]);

  // Computed totals
  const totalAmount = useMemo(() => {
    return lineItems.reduce((sum, li) => sum + (parseFloat(li.amount) || 0), 0);
  }, [lineItems]);

  const laborTotal = useMemo(() => {
    return lineItems.filter((li) => li.type === "labor").reduce((sum, li) => sum + (parseFloat(li.amount) || 0), 0);
  }, [lineItems]);

  const materialsTotal = useMemo(() => {
    return lineItems.filter((li) => isMaterialType(li.type)).reduce((sum, li) => sum + (parseFloat(li.amount) || 0), 0);
  }, [lineItems]);

  // Markup captured across material/appliance lines = charged − total cost, where
  // total cost = qty × cost-each (li.cost is the per-unit cost). Only where cost entered.
  const markupTotal = useMemo(() => {
    return lineItems.reduce((sum, li) => {
      if (!isMaterialType(li.type)) return sum;
      const totalCost = (parseFloat(li.qty) || 0) * (parseFloat(li.cost || "") || 0);
      if (totalCost <= 0) return sum;
      return sum + ((parseFloat(li.amount) || 0) - totalCost);
    }, 0);
  }, [lineItems]);

  // ── Pre-populate from work order or existing invoice ──────────
  useEffect(() => {
    // Reset auto-save state
    userHasEdited.current = false;
    setSaveStatus("idle");
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    if (editInvoice) {
      savedInvoiceIdRef.current = editInvoice.id;
      setPropertyName(editInvoice.property_name);
      setPropertyAddress(editInvoice.property_address);
      setWoReference(editInvoice.wo_reference || "");
      setCompletedDate(editInvoice.completed_date || "");
      setInternalNotes(editInvoice.internal_notes || "");
      setCharge({
        charge_to: editInvoice.charge_to ?? "owner",
        tenant_name: editInvoice.tenant_name ?? "",
        tenant_unit: editInvoice.tenant_unit ?? "",
        tenant_charge_reason: editInvoice.tenant_charge_reason ?? "",
        tenant_charge_note: editInvoice.tenant_charge_note ?? "",
        lease_clause: editInvoice.lease_clause ?? "",
      });

      // Load line items from invoice if present
      if (editInvoice.line_items && editInvoice.line_items.length > 0) {
        setLineItems(
          editInvoice.line_items.map((li) => {
            const liType = (li.type as LineItemType) || "labor";
            const isMat = isMaterialType(liType);
            // Materials: stored cost is the TOTAL; the form edits per-unit cost, so
            // divide by qty (defaulting count to 1 for legacy lines without a qty).
            const matQty = li.qty && li.qty > 0 ? li.qty : 1;
            return {
              id: newLineItemId(),
              type: liType,
              account: li.account || "",
              description: li.description,
              amount: li.amount.toFixed(2),
              qty: isMat ? String(matQty) : li.qty ? String(li.qty) : "",
              rate: li.unit_price ? li.unit_price.toFixed(2) : (liType === "labor" ? STANDARD_RATE.toFixed(2) : ""),
              rateType: "standard" as RateType,
              technician: liType === "labor" ? normalizeTechnician(li.technician) : "",
              cost: li.cost != null ? String(isMat ? li.cost / matQty : li.cost) : "",
              markupPct: li.markup_pct != null ? String(li.markup_pct) : "",
              flatFeeKey: "",
            };
          })
        );
      } else {
        // Legacy invoices without line items — put description into labor line
        const items: FormLineItem[] = [];
        if (editInvoice.labor_amount > 0) {
          items.push({
            id: newLineItemId(),
            type: "labor",
            account: "",
            description: editInvoice.description || "Labor",
            amount: editInvoice.labor_amount.toFixed(2),
            qty: "",
            rate: STANDARD_RATE.toFixed(2),
            rateType: "standard",
            flatFeeKey: "",
          });
        }
        if (editInvoice.materials_amount > 0) {
          items.push({
            id: newLineItemId(),
            type: "materials",
            account: "",
            description: "Materials",
            amount: editInvoice.materials_amount.toFixed(2),
            qty: "1",
            rate: "",
            rateType: "standard",
            flatFeeKey: "",
          });
        }
        if (items.length === 0) {
          items.push({
            id: newLineItemId(),
            type: "labor",
            account: "",
            description: editInvoice.description || "",
            amount: "0.00",
            qty: "",
            rate: STANDARD_RATE.toFixed(2),
            rateType: "standard",
            flatFeeKey: "",
          });
        }
        setLineItems(items);
      }
    } else if (workOrder) {
      savedInvoiceIdRef.current = null;
      setPropertyName(workOrder.property_name);
      setPropertyAddress(workOrder.property_address);
      setWoReference(workOrder.wo_number);
      setCompletedDate(workOrder.completed_date);
      // Owner by default; the unit is ready if this turns out to be a tenant charge.
      setCharge({ ...OWNER_CHARGE, tenant_unit: workOrder.unit || "" });

      // Default the labor tech from the work order's assigned tech (editable per line).
      const defaultTech = normalizeTechnician(workOrder.assigned_to || workOrder.technician);

      // Load line items from scanned PDF — full WO text goes into the labor
      // description so the user can reference it while editing.  The 2-row
      // textarea keeps the UI compact; PDF only prints what the user leaves.

      // Separate any parsed line_items into labor vs materials
      const parsedLineItems = workOrder.line_items || [];
      const parsedLaborItems = parsedLineItems.filter((li) => (li.type as string) !== "materials");
      const parsedMaterialItems = parsedLineItems.filter((li) => (li.type as string) === "materials");

      if (workOrder.task_items && workOrder.task_items.length > 0) {
        // ── TASK-LIST WO ──
        // Labor: consolidated from task items + full WO description for reference
        const taskSummary = workOrder.task_items.join("; ");
        const laborDesc = workOrder.description
          ? `${workOrder.description}`
          : `Labor – ${taskSummary}`;
        const items: FormLineItem[] = [
          {
            id: newLineItemId(),
            type: "labor",
            account: "",
            description: laborDesc,
            amount: workOrder.labor_amount ? workOrder.labor_amount : "0.00",
            qty: "",
            rate: STANDARD_RATE.toFixed(2),
            rateType: "standard",
            technician: defaultTech,
            flatFeeKey: "",
          },
        ];

        // Materials: one line per parsed material, or a blank line if none found
        if (parsedMaterialItems.length > 0) {
          for (const mat of parsedMaterialItems) {
            items.push({
              id: newLineItemId(),
              type: "materials",
              account: mat.account || "",
              description: mat.description,
              amount: (mat.amount || 0).toFixed(2),
              qty: "1",
              rate: "",
              rateType: "standard",
              flatFeeKey: "",
            });
          }
        } else {
          items.push({
            id: newLineItemId(),
            type: "materials",
            account: "",
            description: "Materials",
            amount: workOrder.materials_amount ? workOrder.materials_amount : "0.00",
            qty: "1",
            rate: "",
            rateType: "standard",
            flatFeeKey: "",
          });
        }
        setLineItems(items);

        // If no parsed materials, try AI extraction from the description
        if (parsedMaterialItems.length === 0 && workOrder.description && workOrder.description.trim().length > 10) {
          setExtractingMaterials(true);
          fetch("/api/invoices/extract-materials", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description: workOrder.description }),
          })
            .then((res) => res.json())
            .then((data) => {
              if (data.materials && data.materials.length > 0) {
                setLineItems((prev) => {
                  const updatedLines = prev.map((li) => {
                    if (li.type === "labor" && data.laborDescription) {
                      return { ...li, description: data.laborDescription };
                    }
                    return li;
                  });
                  const nonMaterialLines = updatedLines.filter((li) => li.type !== "materials");
                  const materialLines: FormLineItem[] = data.materials.map(
                    (mat: { description: string; amount: string }) => ({
                      id: newLineItemId(),
                      type: "materials" as LineItemType,
                      account: "",
                      description: mat.description || "Material",
                      amount: mat.amount && parseFloat(mat.amount) > 0 ? parseFloat(mat.amount).toFixed(2) : "0.00",
                      qty: "1",
                      rate: "",
                      rateType: "standard" as RateType,
                      flatFeeKey: "",
                    })
                  );
                  return [...nonMaterialLines, ...materialLines];
                });
              }
            })
            .catch((err) => {
              console.error("Material extraction failed:", err);
            })
            .finally(() => {
              setExtractingMaterials(false);
            });
        }
      } else if (parsedLineItems.length > 0) {
        // ── FINANCIAL WO (Details table) ──
        // Map each line item 1:1 — labor and materials already separated by parser
        const items: FormLineItem[] = parsedLineItems.map((li) => {
          const type = (li.type as LineItemType) || "labor";
          return {
            id: newLineItemId(),
            type,
            account: li.account || "",
            description: li.description,
            amount: li.amount.toFixed(2),
            qty: isMaterialType(type) ? "1" : "",
            rate: type === "labor" ? STANDARD_RATE.toFixed(2) : "",
            rateType: "standard" as RateType,
            technician: type === "labor" ? defaultTech : "",
            flatFeeKey: "",
          };
        });
        // If no materials lines came from parser, add a blank one
        if (parsedMaterialItems.length === 0) {
          items.push({
            id: newLineItemId(),
            type: "materials",
            account: "",
            description: "Materials",
            amount: "0.00",
            qty: "1",
            rate: "",
            rateType: "standard",
            flatFeeKey: "",
          });
        }
        setLineItems(items);
      } else {
        // ── LEGACY / API FALLBACK (no line_items, no task_items) ──
        // Start with labor + one blank materials line, then try AI extraction
        const items: FormLineItem[] = [];
        items.push({
          id: newLineItemId(),
          type: "labor",
          account: "",
          description: workOrder.description || "",
          amount: workOrder.labor_amount && parseFloat(workOrder.labor_amount) > 0
            ? workOrder.labor_amount
            : "0.00",
          qty: "",
          rate: STANDARD_RATE.toFixed(2),
          rateType: "standard",
          technician: defaultTech,
          flatFeeKey: "",
        });
        items.push({
          id: newLineItemId(),
          type: "materials",
          account: "",
          description: "Materials",
          amount: workOrder.materials_amount && parseFloat(workOrder.materials_amount) > 0
            ? workOrder.materials_amount
            : "0.00",
          qty: "1",
          rate: "",
          rateType: "standard",
          flatFeeKey: "",
        });
        setLineItems(items);

        // Try to extract individual materials from the description via AI
        if (workOrder.description && workOrder.description.trim().length > 10) {
          setExtractingMaterials(true);
          fetch("/api/invoices/extract-materials", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description: workOrder.description }),
          })
            .then((res) => res.json())
            .then((data) => {
              if (data.error) {
                console.error("[InvoiceForm] extract-materials ERROR:", data.error);
              }
              if (data.materials && data.materials.length > 0) {
                setLineItems((prev) => {
                  // Update labor line description if AI separated it
                  const updatedLines = prev.map((li) => {
                    if (li.type === "labor" && data.laborDescription) {
                      return { ...li, description: data.laborDescription };
                    }
                    return li;
                  });
                  // Remove placeholder materials lines, add extracted ones
                  const nonMaterialLines = updatedLines.filter((li) => li.type !== "materials");
                  const materialLines: FormLineItem[] = data.materials.map(
                    (mat: { description: string; amount: string }) => ({
                      id: newLineItemId(),
                      type: "materials" as LineItemType,
                      account: "",
                      description: mat.description || "Material",
                      amount: mat.amount && parseFloat(mat.amount) > 0 ? parseFloat(mat.amount).toFixed(2) : "0.00",
                      qty: "1",
                      rate: "",
                      rateType: "standard" as RateType,
                      flatFeeKey: "",
                    })
                  );
                  return [...nonMaterialLines, ...materialLines];
                });
              }
            })
            .catch((err) => {
              console.error("[InvoiceForm] Material extraction failed:", err);
            })
            .finally(() => {
              setExtractingMaterials(false);
            });
        }
      }

      // Store task items for reference
      if (workOrder.task_items && workOrder.task_items.length > 0) {
        setTaskItems(workOrder.task_items);
      }

      // Store scanned metadata for context
      setScannedMeta({
        technician: workOrder.technician || undefined,
        technicianNotes: workOrder.technician_notes || undefined,
        status: workOrder.status || undefined,
        createdDate: workOrder.created_date || undefined,
        scheduledDate: workOrder.scheduled_date || undefined,
        permissionToEnter: workOrder.permission_to_enter || undefined,
        maintenanceLimit: workOrder.maintenance_limit || undefined,
        pets: workOrder.pets || undefined,
        estimateAmount: workOrder.estimate_amount || undefined,
        vendorInstructions: workOrder.vendor_instructions || undefined,
        propertyNotes: workOrder.property_notes || undefined,
        createdBy: workOrder.created_by || undefined,
      });

      // Pre-fill internal notes with comprehensive WO reference
      const noteParts: string[] = [];
      noteParts.push("=== WORK ORDER REFERENCE ===");
      if (workOrder.wo_number) noteParts.push(`WO#: ${workOrder.wo_number}`);
      noteParts.push(`Property: ${workOrder.property_name}`);
      if (workOrder.property_address) noteParts.push(`Address: ${workOrder.property_address}`);
      if (workOrder.unit) noteParts.push(`Unit: ${workOrder.unit}`);
      if (workOrder.status) noteParts.push(`Status: ${workOrder.status}`);
      if (workOrder.category) noteParts.push(`Category: ${workOrder.category}`);
      if (workOrder.assigned_to) noteParts.push(`Assigned To: ${workOrder.assigned_to}`);
      if (workOrder.created_date) noteParts.push(`Created: ${workOrder.created_date}`);
      if (workOrder.scheduled_date) noteParts.push(`Scheduled: ${workOrder.scheduled_date}`);
      if (workOrder.completed_date) noteParts.push(`Completed: ${workOrder.completed_date}`);
      if (workOrder.permission_to_enter) noteParts.push(`Permission to Enter: ${workOrder.permission_to_enter}`);
      if (workOrder.maintenance_limit) noteParts.push(`Maintenance Limit: $${workOrder.maintenance_limit}`);
      if (workOrder.estimate_amount) noteParts.push(`Estimate: $${workOrder.estimate_amount}`);
      if (workOrder.pets) noteParts.push(`Pets: ${workOrder.pets}`);
      if (workOrder.technician || workOrder.created_by) noteParts.push(`Technician: ${workOrder.technician || workOrder.created_by}`);
      if (workOrder.vendor_instructions) noteParts.push(`\nVendor Instructions:\n${workOrder.vendor_instructions}`);
      if (workOrder.property_notes) noteParts.push(`\nProperty Notes:\n${workOrder.property_notes}`);
      if (workOrder.technician_notes) noteParts.push(`\nTechnician Notes:\n${workOrder.technician_notes}`);
      if (workOrder.description) noteParts.push(`\nDescription:\n${workOrder.description}`);
      if (workOrder.task_items?.length) noteParts.push(`\nTasks:\n${workOrder.task_items.map((t) => `• ${t}`).join("\n")}`);
      setInternalNotes(noteParts.join("\n"));
    } else {
      savedInvoiceIdRef.current = null;
      setLineItems([blankLineItem(initialLineType)]);
    }
  }, [workOrder, editInvoice, initialLineType]);

  // ── Auto-save effect (debounced 2s) ──────────
  useEffect(() => {
    if (!canEdit || !userHasEdited.current) return;
    if (isSavingRef.current || isGeneratingRef.current) return;

    // Need at least property name and a completed date to persist — the invoice
    // must not exist without a completed date (required to save or print).
    if (!propertyName.trim() || !completedDate.trim()) return;

    setSaveStatus("unsaved");

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    autoSaveTimerRef.current = setTimeout(async () => {
      if (isSavingRef.current || isGeneratingRef.current) return;

      setSaveStatus("saving");
      try {
        const payload = buildSavePayload();

        if (savedInvoiceIdRef.current) {
          const res = await fetch(`/api/invoices/${savedInvoiceIdRef.current}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          setSaveStatus(res.ok ? "saved" : "unsaved");
        } else {
          const res = await fetch("/api/invoices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (res.ok) {
            savedInvoiceIdRef.current = data.invoice.id;
            setSaveStatus("saved");
          } else {
            setSaveStatus("unsaved");
          }
        }
      } catch {
        setSaveStatus("unsaved");
      }
    }, 2000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyName, propertyAddress, woReference, completedDate, internalNotes, lineItems, charge, canEdit]);

  // ── Warn before page unload if unsaved ──────────
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (userHasEdited.current && saveStatus !== "saved" && saveStatus !== "idle") {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveStatus]);

  // ── Line item CRUD ──────────
  function updateLineItem(id: string, field: keyof Omit<FormLineItem, "id">, value: string) {
    userHasEdited.current = true;
    setLineItems((prev) =>
      prev.map((li) => {
        if (li.id !== id) return li;
        const updated = { ...li, [field]: value };

        // When toggling rateType (labor-only), also update the rate
        if (field === "rateType" && updated.type === "labor") {
          updated.rate = value === "after-hours"
            ? AFTER_HOURS_RATE.toFixed(2)
            : STANDARD_RATE.toFixed(2);
        }

        // Auto-calculate amount = qty × rate for labor/other (materials use cost × markup below)
        if ((field === "qty" || field === "rate" || field === "rateType") && !isMaterialType(updated.type)) {
          const q = parseFloat(updated.qty) || 0;
          const r = parseFloat(updated.rate) || 0;
          if (q > 0 && r > 0) {
            updated.amount = (q * r).toFixed(2);
          }
        }

        // Materials/appliance: charged = qty × cost-each × (1 + markup%). li.cost is
        // the per-unit cost. Editing the amount directly still works (manual override).
        if ((field === "qty" || field === "cost" || field === "markupPct") && isMaterialType(updated.type)) {
          const q = parseFloat(updated.qty) || 0;
          const unitCost = parseFloat(updated.cost || "") || 0;
          const mk = parseFloat(effMarkup(updated)) || 0;
          if (q > 0 && unitCost > 0) updated.amount = chargedFromCost(q * unitCost, mk).toFixed(2);
        }

        // When switching type TO labor, set default rate fields
        if (field === "type" && value === "labor") {
          updated.rate = STANDARD_RATE.toFixed(2);
          updated.rateType = "standard";
          updated.cost = "";
          updated.markupPct = "";
          updated.flatFeeKey = "";
        }
        // When switching type TO materials/appliance, clear labor fields and set
        // the type's default markup, recomputing the charge if a cost is present.
        if (field === "type" && (value === "materials" || value === "appliance")) {
          updated.rate = "";
          updated.rateType = "standard";
          updated.markupPct = value === "appliance"
            ? String(DEFAULT_MARKUP_PCT.appliance)
            : String(DEFAULT_MARKUP_PCT.materials);
          if (!(parseFloat(updated.qty) > 0)) updated.qty = "1";
          const q = parseFloat(updated.qty) || 0;
          const unitCost = parseFloat(updated.cost || "") || 0;
          if (q > 0 && unitCost > 0) {
            updated.amount = chargedFromCost(q * unitCost, parseFloat(updated.markupPct)).toFixed(2);
          }
        }
        // When switching type TO other, clear specifics
        if (field === "type" && value === "other") {
          updated.rate = "";
          updated.rateType = "standard";
          updated.cost = "";
          updated.markupPct = "";
          updated.flatFeeKey = "";
        }

        return updated;
      })
    );
  }

  function removeLineItem(id: string) {
    userHasEdited.current = true;
    setLineItems((prev) => {
      const filtered = prev.filter((li) => li.id !== id);
      return filtered.length === 0 ? [blankLineItem()] : filtered;
    });
  }

  function addLineItem(type: LineItemType = "labor") {
    userHasEdited.current = true;
    setLineItems((prev) => [...prev, blankLineItem(type)]);
  }

  // ── Flat fee selection ──────────
  function handleFlatFeeSelect(lineItemId: string, feeKey: string) {
    userHasEdited.current = true;
    const job = FLAT_FEE_JOBS.find((j) => j.key === feeKey);
    setLineItems((prev) =>
      prev.map((li) => {
        if (li.id !== lineItemId) return li;
        if (job) {
          return { ...li, flatFeeKey: feeKey, description: job.description, amount: job.amount.toFixed(2) };
        }
        return { ...li, flatFeeKey: "" };
      })
    );
  }

  function formatDateForInput(dateStr: string): string {
    if (!dateStr) return "";
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) return dateStr;
    return parsed.toISOString().split("T")[0];
  }

  // ── Build save payload ──────────
  function buildSavePayload() {
    // Save ALL line items the user has in the form — if they added it, keep it
    const validLineItems: LineItem[] = lineItems
      .map((li) => {
        const isMat = isMaterialType(li.type);
        const qty = parseFloat(li.qty) || 0;
        const unitCost = isMat ? parseFloat(li.cost || "") || 0 : 0;
        const markup = isMat ? parseFloat(effMarkup(li)) || 0 : 0;
        // Materials: li.cost is per-unit; persist total cost (qty × cost-each) so the
        // markup report's margin (amount − cost) stays correct, and a charged unit
        // price so qty × unit_price = amount on the owner PDF (cost/markup stay hidden).
        const totalCost = isMat ? qty * unitCost : 0;
        const materialUnitPrice = isMat && qty > 0 ? (parseFloat(li.amount) || 0) / qty : 0;
        return {
          description: li.description.trim(),
          account: li.account.trim() || undefined,
          type: li.type,
          technician: li.type === "labor" ? li.technician || undefined : undefined,
          qty: qty || undefined,
          unit_price: isMat ? materialUnitPrice || undefined : parseFloat(li.rate) || undefined,
          amount: parseFloat(li.amount) || 0,
          // Internal cost/markup — only when a cost was actually entered.
          cost: isMat && totalCost > 0 ? totalCost : undefined,
          markup_pct: isMat && totalCost > 0 ? markup : undefined,
        };
      });

    const computedTotal = validLineItems.reduce((sum, li) => sum + li.amount, 0);
    const computedLabor = validLineItems.filter((li) => li.type === "labor").reduce((sum, li) => sum + li.amount, 0);
    const computedMaterials = validLineItems
      .filter((li) => li.type === "materials" || li.type === "appliance")
      .reduce((sum, li) => sum + li.amount, 0);

    // Short summary for the invoice description field (used for search, not shown on PDF when line items exist)
    const allDescs = validLineItems
      .filter((li) => li.description)
      .map((li) => {
        // Truncate long descriptions to first line or 80 chars for the summary
        const first = li.description.split('\n')[0].trim();
        return first.length > 80 ? first.slice(0, 77) + '...' : first;
      });
    const composedDescription =
      allDescs.join("; ") ||
      "Maintenance services performed";

    return {
      property_name: propertyName.trim(),
      property_address: propertyAddress.trim(),
      wo_reference: woReference.trim() || null,
      completed_date: formatDateForInput(completedDate) || null,
      description: composedDescription,
      labor_amount: computedLabor,
      materials_amount: computedMaterials,
      total_amount: computedTotal,
      line_items: validLineItems.length > 0 ? validLineItems : null,
      internal_notes: internalNotes.trim() || null,
      ...chargePayload(charge),
    };
  }

  // ── Manual save / generate PDF ──────────
  async function handleSave(generatePdf: boolean) {
    setError(null);
    if (!canEdit || (generatePdf && !canIssue)) return;

    if (!propertyName.trim() || !propertyAddress.trim()) {
      setError("Property name and address are required");
      return;
    }

    if (!completedDate.trim()) {
      setError("Completed date is required before saving or printing the invoice.");
      return;
    }

    if (generatePdf) {
      const problems = chargeProblems(chargePayload(charge), { finalizing: true });
      if (problems.length) {
        setError(problems.join(" "));
        return;
      }
    }

    // Cancel any pending auto-save
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    const setter = generatePdf ? setIsGenerating : setIsSaving;
    setter(true);

    try {
      const payload = buildSavePayload();

      let invoice: HdmsInvoice;
      const existingId = savedInvoiceIdRef.current;

      if (existingId) {
        // Update existing (from editInvoice or auto-saved new)
        const res = await fetch(`/api/invoices/${existingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        invoice = data.invoice;
      } else {
        // Create new
        const res = await fetch("/api/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        invoice = data.invoice;
        savedInvoiceIdRef.current = invoice.id;
      }

      if (generatePdf) {
        const pdfRes = await fetch(`/api/invoices/${invoice.id}/generate-pdf`, {
          method: "POST",
        });
        const pdfData = await pdfRes.json();
        if (!pdfRes.ok) throw new Error(pdfData.error);
        invoice = pdfData.invoice;

        const dlRes = await fetch(`/api/invoices/${invoice.id}/download`);
        const dlData = await dlRes.json();
        if (dlRes.ok && dlData.downloadUrl) {
          window.open(dlData.downloadUrl, "_blank");
        }
      }

      setSaveStatus("saved");
      userHasEdited.current = false;
      onSaved(invoice);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsSaving(false);
      setIsGenerating(false);
    }
  }

  const isLoading = isSaving || isGenerating;
  const hasScannedMeta = Object.values(scannedMeta).some(Boolean);
  const unpricedCount = lineItems.filter((li) => li.description.trim() && (parseFloat(li.amount) || 0) === 0).length;

  if (!canEdit) return <div className="rounded-xl border p-6"><p>This invoice requires office review. You can prepare and edit your own unissued drafts.</p><Button onClick={onBack}>Back to Work &amp; Billing</Button></div>;

  return (
    <div className="animate-slide-up">
      {!canIssue && <p className="mb-4 rounded-xl bg-amber-50 p-4 text-sm">Enter your completed work and save a draft. The office reviews the draft and generates the final invoice PDF. No estimate is required for already-authorized work.</p>}
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={isLoading}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <h3 className="text-lg font-semibold text-charcoal-900">
          {editInvoice ? `Edit ${editInvoice.invoice_code}` : initialLineType === "appliance" ? "New Appliance Invoice" : "New Invoice"}
        </h3>

        {/* Auto-save status indicator */}
        <div className="ml-auto">
          {saveStatus === "saving" && (
            <span className="flex items-center gap-1.5 text-xs text-charcoal-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving...
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="flex items-center gap-1.5 text-xs text-terra-500">
              <Check className="h-3 w-3" />
              Saved
            </span>
          )}
          {saveStatus === "unsaved" && (
            <span className="flex items-center gap-1.5 text-xs text-amber-500">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              Unsaved changes
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-sand-200 p-6 space-y-6">
        {/* Property Info */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-charcoal-400 uppercase tracking-wider mb-1.5">
              Property Name
            </label>
            <Input
              value={propertyName}
              onChange={(e) => { userHasEdited.current = true; setPropertyName(e.target.value); }}
              placeholder="Property name"
              disabled={isLoading}
              className="bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-charcoal-400 uppercase tracking-wider mb-1.5">
              Property Address
            </label>
            <Input
              value={propertyAddress}
              onChange={(e) => { userHasEdited.current = true; setPropertyAddress(e.target.value); }}
              placeholder="Full address"
              disabled={isLoading}
              className="bg-white"
            />
          </div>
        </div>

        {/* WO Reference & Date */}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-charcoal-400 uppercase tracking-wider mb-1.5">
              Work Order Reference
            </label>
            <Input
              value={woReference}
              onChange={(e) => { userHasEdited.current = true; setWoReference(e.target.value); }}
              placeholder="WO #"
              disabled={isLoading}
              className="bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-charcoal-400 uppercase tracking-wider mb-1.5">
              Completed Date <span className="text-red-500">*</span>
            </label>
            <Input
              type="date"
              required
              value={formatDateForInput(completedDate)}
              onChange={(e) => { userHasEdited.current = true; setCompletedDate(e.target.value); }}
              disabled={isLoading}
              className="bg-white"
            />
          </div>
        </div>

        {/* Who pays */}
        <div className="rounded-xl border border-sand-200 px-4 py-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-charcoal-400 uppercase tracking-wider">Charge to <span className="text-red-500">*</span></p>
              <p className="text-xs text-charcoal-400">An invoice charges the owner or the tenant, never both. Bill a split job as two invoices.</p>
            </div>
            <div role="radiogroup" aria-label="Charge to" className="inline-flex rounded-lg border border-sand-300 p-0.5">
              {(["owner", "tenant"] as const).map((who) => (
                <button
                  key={who}
                  type="button"
                  role="radio"
                  aria-checked={charge.charge_to === who}
                  disabled={isLoading || chargeLocked}
                  onClick={() => updateCharge({ charge_to: who })}
                  className={`px-3 py-1.5 text-sm rounded-md ${charge.charge_to === who ? (who === "tenant" ? "bg-red-600 text-white" : "bg-terra-600 text-white") : "text-charcoal-600 hover:bg-sand-100"}`}
                >
                  {who === "owner" ? "Owner charge" : "Tenant charge"}
                </button>
              ))}
            </div>
          </div>
          {chargeLocked && <p className="text-xs text-charcoal-500">Who pays is fixed because this invoice is attached in AppFolio or its tenant charge is posted. Void it and issue a new one to change it.</p>}
          {charge.charge_to === "tenant" && !chargeLocked && (tenantLookupBusy || tenantMatches) && (
            <div className="rounded-lg bg-sand-50 border border-sand-200 px-3 py-2 text-xs text-charcoal-600">
              {tenantLookupBusy ? (
                "Looking up the current tenant in AppFolio…"
              ) : tenantMatches && tenantMatches.length === 1 ? (
                <>Tenant and unit filled from AppFolio{tenantMatches[0].syncedAt ? ` (synced ${new Date(tenantMatches[0].syncedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })})` : ""}. Check them against the work order.</>
              ) : tenantMatches && tenantMatches.length > 1 ? (
                <div>
                  <p className="mb-1.5">Several households at this address — pick the one this charge is for:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tenantMatches.map((m) => (
                      <button
                        key={`${m.unit}|${m.tenantName}`}
                        type="button"
                        onClick={() => updateCharge({ tenant_name: m.tenantName, tenant_unit: m.unit || charge.tenant_unit })}
                        className={`rounded-md border px-2 py-1 text-left ${charge.tenant_name === m.tenantName ? "border-terra-500 bg-white" : "border-sand-300 bg-white hover:bg-sand-100"}`}
                      >
                        <span className="font-medium text-charcoal-800">{m.unit ? `Unit ${m.unit}` : m.address}</span> · {m.tenantName}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                "No current tenant found for this address in AppFolio — enter the name as on the lease."
              )}
            </div>
          )}
          {charge.charge_to === "tenant" && (
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="tenant-name" className="block text-xs font-medium text-charcoal-400 uppercase tracking-wider mb-1.5">Tenant name <span className="text-red-500">*</span></label>
                <Input id="tenant-name" value={charge.tenant_name} onChange={(e) => updateCharge({ tenant_name: e.target.value })} placeholder="As on the lease" disabled={isLoading || chargeLocked} className="bg-white" />
              </div>
              <div>
                <label htmlFor="tenant-unit" className="block text-xs font-medium text-charcoal-400 uppercase tracking-wider mb-1.5">Unit <span className="text-red-500">*</span></label>
                <Input id="tenant-unit" value={charge.tenant_unit} onChange={(e) => updateCharge({ tenant_unit: e.target.value })} placeholder="Unit" disabled={isLoading || chargeLocked} className="bg-white" />
              </div>
              <div>
                <label htmlFor="tenant-reason" className="block text-xs font-medium text-charcoal-400 uppercase tracking-wider mb-1.5">Reason <span className="normal-case tracking-normal text-charcoal-400">(optional — the office can add it)</span></label>
                <select id="tenant-reason" value={charge.tenant_charge_reason} onChange={(e) => updateCharge({ tenant_charge_reason: e.target.value as TenantChargeReason | "" })} disabled={isLoading || chargeLocked} className="h-9 w-full rounded-md border border-sand-300 bg-white px-2 text-sm">
                  <option value="">Not sure — office to choose</option>
                  {(Object.keys(TENANT_REASON_LABEL) as TenantChargeReason[]).map((r) => <option key={r} value={r}>{TENANT_REASON_LABEL[r]}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="lease-clause" className="block text-xs font-medium text-charcoal-400 uppercase tracking-wider mb-1.5">Lease clause <span className="normal-case tracking-normal text-charcoal-400">(optional — the office can add it)</span></label>
                <Input id="lease-clause" value={charge.lease_clause} onChange={(e) => updateCharge({ lease_clause: e.target.value })} placeholder="e.g. Section 14, lockout fee" disabled={isLoading || chargeLocked} className="bg-white" />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="tenant-note" className="block text-xs font-medium text-charcoal-400 uppercase tracking-wider mb-1.5">What happened, and the evidence <span className="text-red-500">*</span></label>
                <textarea id="tenant-note" value={charge.tenant_charge_note} onChange={(e) => updateCharge({ tenant_charge_note: e.target.value })} rows={2} placeholder="e.g. Tenant-caused damage to bathroom door; photos on WO" disabled={isLoading || chargeLocked} className="w-full rounded-md border border-sand-300 bg-white px-3 py-2 text-sm" />
                <p className="mt-1 text-xs text-charcoal-400">The owner pays this invoice as usual; the office then posts the charge to the tenant’s ledger to reimburse the owner. The note stays internal.</p>
              </div>
            </div>
          )}
        </div>

        {/* Scanned Work Order Context (if available) */}
        {hasScannedMeta && (
          <div className="rounded-xl bg-blue-50/60 border border-blue-200/40 px-4 py-3 space-y-2">
            <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider">
              Work Order Details
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 text-xs text-charcoal-600">
              {scannedMeta.status && (
                <div><span className="font-medium text-charcoal-500">Status:</span> {scannedMeta.status}</div>
              )}
              {(scannedMeta.technician || scannedMeta.createdBy) && (
                <div><span className="font-medium text-charcoal-500">Technician:</span> {scannedMeta.technician || scannedMeta.createdBy}</div>
              )}
              {scannedMeta.createdDate && (
                <div><span className="font-medium text-charcoal-500">Created:</span> {scannedMeta.createdDate}</div>
              )}
              {scannedMeta.scheduledDate && (
                <div><span className="font-medium text-charcoal-500">Scheduled:</span> {scannedMeta.scheduledDate}</div>
              )}
              {scannedMeta.maintenanceLimit && (
                <div><span className="font-medium text-charcoal-500">Maint Limit:</span> ${scannedMeta.maintenanceLimit}</div>
              )}
              {scannedMeta.estimateAmount && (
                <div><span className="font-medium text-charcoal-500">Estimate:</span> ${scannedMeta.estimateAmount}</div>
              )}
              {scannedMeta.permissionToEnter && (
                <div><span className="font-medium text-charcoal-500">Permission:</span> {scannedMeta.permissionToEnter}</div>
              )}
              {scannedMeta.pets && (
                <div><span className="font-medium text-charcoal-500">Pets:</span> {scannedMeta.pets}</div>
              )}
            </div>
            {scannedMeta.vendorInstructions && (
              <p className="text-[11px] text-charcoal-500">
                <span className="font-medium">Vendor Instructions:</span> {scannedMeta.vendorInstructions}
              </p>
            )}
            {scannedMeta.propertyNotes && (
              <p className="text-[11px] text-charcoal-500">
                <span className="font-medium">Property Notes:</span> {scannedMeta.propertyNotes}
              </p>
            )}

            {/* Technician's Notes (expandable) */}
            {scannedMeta.technicianNotes && (
              <div className="mt-1">
                <button
                  type="button"
                  onClick={() => setShowTechNotes(!showTechNotes)}
                  className="text-[11px] font-medium text-blue-600 hover:text-blue-800 transition-colors"
                >
                  {showTechNotes ? "Hide" : "Show"} Technician&apos;s Notes
                </button>
                {showTechNotes && (
                  <div className="mt-1.5 p-3 bg-white rounded-xl shadow-card border border-blue-100/60 text-[11px] text-charcoal-600 leading-relaxed whitespace-pre-wrap">
                    {scannedMeta.technicianNotes}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Task List Reference (collapsible, from scanned task-list WOs) */}
        {taskItems.length > 0 && (
          <div className="rounded-xl bg-terra-50/50 border border-terra-200/40 px-4 py-3">
            <button
              type="button"
              onClick={() => setShowTaskList(!showTaskList)}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-semibold text-terra-700 uppercase tracking-wider">
                  Work Order Tasks ({taskItems.length})
                </p>
              </div>
              <span className="text-[11px] font-medium text-terra-600">
                {showTaskList ? "Hide" : "Show"} Task List
              </span>
            </button>
            {showTaskList && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-charcoal-600 list-disc list-inside max-h-48 overflow-y-auto">
                {taskItems.map((task, idx) => (
                  <li key={idx} className="leading-relaxed">{task}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ============================== */}
        {/* Line Items                     */}
        {/* ============================== */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <label className="block text-xs font-medium text-charcoal-400 uppercase tracking-wider">
                Line Items
              </label>
              {extractingMaterials && (
                <p className="text-[10px] text-blue-500 mt-0.5 flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Extracting materials from work order…
                </p>
              )}
              {!extractingMaterials && unpricedCount > 0 && (
                <p className="text-[10px] text-amber-600 mt-0.5">
                  {unpricedCount} item{unpricedCount !== 1 ? "s" : ""} need pricing
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => addLineItem("labor")}
                disabled={isLoading}
                className="text-blue-600 hover:text-blue-800 text-xs h-7"
              >
                <Wrench className="h-3 w-3 mr-1" />
                + Labor
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => addLineItem("materials")}
                disabled={isLoading}
                className="text-amber-600 hover:text-amber-800 text-xs h-7"
              >
                <Package className="h-3 w-3 mr-1" />
                + Materials
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => addLineItem("appliance")}
                disabled={isLoading}
                className="text-orange-600 hover:text-orange-800 text-xs h-7"
              >
                <Refrigerator className="h-3 w-3 mr-1" />
                + Appliance
              </Button>
            </div>
          </div>

          <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
            <strong>Hourly maintenance / manual work</strong>
            <p className="mt-1">For work without a flat price, add labor, select Al (Alberto) or Brody, enter hours and describe the repair and location. Use a separate line for each technician. Add parts with + Materials.</p>
            {hourlyItem && <button type="button" disabled={isLoading} className="mt-2 font-medium text-blue-800 underline" onClick={() => {
              userHasEdited.current = true;
              const technician = normalizeTechnician(workOrder?.assigned_to || workOrder?.technician);
              const line = {...blankLineItem('labor', technician), qty: '1', rate: hourlyItem.base_price.toFixed(2), amount: hourlyItem.base_price.toFixed(2)};
              setLineItems(prev => [...prev, line]);
            }}>+ 1 hour {priceBookName(hourlyItem)} · {priceBookRate(hourlyItem)}</button>}
            {priceBookError && <p className="mt-2 text-amber-800">{priceBookError}</p>}
            <p className="mt-1 text-xs">Edit Qty/Hrs after adding: 0.5 = 30 minutes, 1.5 = 1 hour 30 minutes. Describe the work before saving.</p>
          </div>

          <div className="rounded-xl border border-sand-200 bg-white overflow-x-auto">
            {/* Table header */}
            <div className="grid min-w-[560px] grid-cols-[80px_1fr_60px_80px_48px_90px_36px] gap-2 px-3 py-2 bg-charcoal-50 border-b border-sand-200 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">
              <span>Type</span>
              <span>Description</span>
              <span title="Hours for labor · Qty for materials & appliances">Qty/Hrs</span>
              <span title="Rate for labor · Cost each (internal) for materials & appliances">Rate/Cost</span>
              <span className="text-center" title="After-hours toggle for labor · Markup % (internal) for materials & appliances">OT/Mk%</span>
              <span className="text-right">Charged</span>
              <span />
            </div>

            {/* Table rows */}
            {lineItems.map((li, idx) => {
              const typeStyle = TYPE_STYLES[li.type];
              const isUnpriced = li.description.trim() && (parseFloat(li.amount) || 0) === 0;
              const isLabor = li.type === "labor";
              const isMaterials = li.type === "materials";
              const isMaterial = isMaterialType(li.type);

              return (
                <div
                  key={li.id}
                  className={`grid min-w-[560px] grid-cols-[80px_1fr_60px_80px_48px_90px_36px] gap-2 px-3 py-1.5 border-b border-charcoal-100 last:border-b-0 items-start ${
                    isUnpriced ? "bg-amber-50/30" : ""
                  }`}
                >
                  {/* Type selector */}
                  <select
                    value={li.type}
                    onChange={(e) => updateLineItem(li.id, "type", e.target.value)}
                    disabled={isLoading}
                    className={`h-8 text-[10px] font-medium rounded-lg border border-sand-200 px-1.5 ${typeStyle.bg} ${typeStyle.text} cursor-pointer focus:outline-none focus:ring-2 focus:ring-terra-600/30`}
                  >
                    <option value="labor">Labor</option>
                    <option value="materials">Materials</option>
                    <option value="appliance">Appliance</option>
                    <option value="other">Other</option>
                  </select>

                  {/* Description */}
                  <div className="relative min-w-0">
                    {/* Tech attribution for labor — initials print on the invoice (BB/AF) */}
                    {isLabor && (
                      <select
                        value={li.technician || ""}
                        onChange={(e) => updateLineItem(li.id, "technician", e.target.value)}
                        disabled={isLoading}
                        className={`w-full h-7 text-[10px] font-medium rounded-lg border px-2 mb-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-terra-600/30 ${
                          li.technician
                            ? "border-blue-200/60 bg-blue-50/40 text-blue-700"
                            : "border-amber-300/60 bg-amber-50/40 text-amber-700"
                        }`}
                        title="Which tech performed this labor"
                      >
                        <option value="">Tech… (unassigned)</option>
                        {TECHNICIANS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    )}
                    {/* Flat fee dropdown for materials */}
                    {isMaterials && FLAT_FEE_JOBS.length > 0 && (
                      <select
                        value={li.flatFeeKey}
                        onChange={(e) => handleFlatFeeSelect(li.id, e.target.value)}
                        disabled={isLoading}
                        className="w-full h-7 text-[10px] font-medium rounded-lg border border-amber-200/60 bg-amber-50/40 text-amber-700 px-2 mb-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-terra-600/30"
                      >
                        <option value="">Custom entry</option>
                        {FLAT_FEE_JOBS.map((job) => (
                          <option key={job.key} value={job.key}>
                            {job.label} — ${job.amount}
                          </option>
                        ))}
                      </select>
                    )}
                    <textarea
                      value={li.description}
                      onChange={(e) => updateLineItem(li.id, "description", e.target.value)}
                      placeholder={idx === 0 && isLabor ? "Describe the work performed...\n• Bullet points supported" : isMaterials ? "Parts / materials description" : `Line item ${idx + 1} description`}
                      disabled={isLoading}
                      rows={2}
                      className={`w-full text-xs bg-transparent border border-sand-200 rounded-md px-3 py-2 resize-y leading-relaxed focus:outline-none focus:ring-2 focus:ring-terra-600/30 disabled:opacity-50 ${
                        li.description.trim().length > 3 ? "pr-10" : ""
                      }`}
                    />
                    <ImproveWithAI value={li.description} context="invoice" disabled={isLoading || !canEdit}
                      onApply={(text) => updateLineItem(li.id, "description", text)} />
                  </div>

                  {/* Qty/Hrs — hours for labor, count for materials/appliance/other */}
                  <Input
                    type="number"
                    step={isLabor ? "0.25" : "1"}
                    min="0"
                    value={li.qty}
                    onChange={(e) => updateLineItem(li.id, "qty", e.target.value)}
                    placeholder={isLabor ? "Hrs" : "Qty"}
                    disabled={isLoading}
                    className="h-8 text-xs text-center bg-transparent border-sand-200"
                  />

                  {/* Rate (labor/other) OR Cost each (materials/appliance — internal only) */}
                  {isMaterial ? (
                    <div className="relative">
                      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-charcoal-400 text-[10px]">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={li.cost ?? ""}
                        onChange={(e) => updateLineItem(li.id, "cost", e.target.value)}
                        placeholder="cost ea"
                        disabled={isLoading}
                        title="Cost each — what HDMS paid per unit; internal only, never shown on the owner's invoice"
                        className="h-8 text-xs pl-4 text-right bg-transparent border-sand-200"
                      />
                    </div>
                  ) : (
                    <div className="relative">
                      <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-charcoal-400 text-[10px]">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={li.rate}
                        onChange={(e) => updateLineItem(li.id, "rate", e.target.value)}
                        placeholder={isLabor ? "/hr" : "ea"}
                        disabled={isLoading}
                        className="h-8 text-xs pl-4 text-right bg-transparent border-sand-200"
                      />
                    </div>
                  )}

                  {/* Labor: OT toggle · Materials/appliance: Markup % (internal) · Other: spacer */}
                  {isLabor ? (
                    <button
                      type="button"
                      onClick={() =>
                        updateLineItem(li.id, "rateType", li.rateType === "standard" ? "after-hours" : "standard")
                      }
                      disabled={isLoading}
                      title={li.rateType === "after-hours" ? "After-hours / Emergency rate (1.5×)" : "Click for overtime / after-hours rate"}
                      className={`flex items-center justify-center h-8 w-full rounded-lg text-[10px] font-bold transition-all duration-200 ${
                        li.rateType === "after-hours"
                          ? "bg-red-100 text-red-700 ring-2 ring-red-400 shadow-sm"
                          : "bg-terra-50 text-terra-500 ring-1 ring-terra-300 hover:bg-red-50 hover:text-red-500 hover:ring-red-300"
                      }`}
                    >
                      <Clock className="h-3 w-3 mr-0.5" />
                      OT
                    </button>
                  ) : isMaterial ? (
                    <div className="relative">
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        value={effMarkup(li)}
                        onChange={(e) => updateLineItem(li.id, "markupPct", e.target.value)}
                        disabled={isLoading}
                        title="Markup % applied to cost — internal only. Defaults: 25% materials, 10% appliance."
                        className="h-8 text-xs px-1 pr-3.5 text-right bg-transparent border-sand-200"
                      />
                      <span className="absolute right-1 top-1/2 -translate-y-1/2 text-charcoal-400 text-[10px]">%</span>
                    </div>
                  ) : (
                    <span />
                  )}

                  {/* Extended Amount (qty × price) */}
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-charcoal-400 text-xs">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={li.amount}
                      onChange={(e) => updateLineItem(li.id, "amount", e.target.value)}
                      disabled={isLoading}
                      className={`h-8 text-xs pl-5 text-right bg-transparent border-sand-200 ${
                        isUnpriced ? "border-amber-300/60" : ""
                      }`}
                    />
                  </div>

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => removeLineItem(li.id)}
                    disabled={isLoading}
                    className="flex items-center justify-center h-8 w-8 text-charcoal-300 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50/60"
                    title="Remove line item"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}

            {/* Subtotals + Total row */}
            <div className="bg-charcoal-50 border-t border-sand-200 px-3 py-2.5 space-y-1">
              {(laborTotal > 0 || materialsTotal > 0) && (laborTotal !== totalAmount) && (
                <div className="grid grid-cols-[80px_1fr_60px_80px_48px_90px_36px] gap-2 items-center">
                  <span />
                  <div className="flex justify-end gap-6 text-[10px] text-charcoal-400">
                    {laborTotal > 0 && (
                      <span>Labor: <span className="font-medium text-blue-600">${laborTotal.toFixed(2)}</span></span>
                    )}
                    {materialsTotal > 0 && (
                      <span>Materials: <span className="font-medium text-amber-600">${materialsTotal.toFixed(2)}</span></span>
                    )}
                    {markupTotal > 0 && (
                      <span title="Margin captured on materials & appliances (internal only)">
                        Markup: <span className="font-medium text-orange-600">${markupTotal.toFixed(2)}</span>
                      </span>
                    )}
                  </div>
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              )}
              <div className="grid grid-cols-[80px_1fr_60px_80px_48px_90px_36px] gap-2 items-center">
                <span />
                <span />
                <span />
                <span />
                <span className="text-right text-xs font-semibold text-charcoal-600">Total</span>
                <span className="text-right text-sm font-bold text-charcoal-900">
                  ${totalAmount.toFixed(2)}
                </span>
                <span />
              </div>
            </div>
          </div>
        </div>

        {/* Internal Notes */}
        <div>
          <label className="block text-xs font-medium text-charcoal-400 uppercase tracking-wider mb-1.5">
            Internal Notes (not shown on invoice)
          </label>
          <textarea
            value={internalNotes}
            onChange={(e) => { userHasEdited.current = true; setInternalNotes(e.target.value); }}
            placeholder="Internal notes, vendor instructions, property notes..."
            rows={6}
            disabled={isLoading}
            className="flex w-full rounded-xl border border-input bg-white px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-600/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-sand-200">
          <Button
            variant="outline"
            onClick={() => handleSave(false)}
            disabled={isLoading}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save as Draft
          </Button>
          {canIssue && <Button
            onClick={() => handleSave(true)}
            disabled={isLoading}
            className="bg-terra-500 hover:bg-terra-600 text-white transition-all duration-200"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4 mr-2" />
            )}
            Generate Invoice PDF
          </Button>}
        </div>
      </div>
    </div>
  );
}

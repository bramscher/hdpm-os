"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { ArrowLeft, Save, FileDown, Loader2, Trash2, Wrench, Package, Check, Sparkles, Clock, Refrigerator } from "lucide-react";
import { Button } from "@/components/ui/button";
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

interface InvoiceFormProps {
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

export function InvoiceForm({ workOrder, editInvoice, onBack, onSaved }: InvoiceFormProps) {
  // Header fields
  const [propertyName, setPropertyName] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [woReference, setWoReference] = useState("");
  const [completedDate, setCompletedDate] = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  // Line items
  const [lineItems, setLineItems] = useState<FormLineItem[]>([blankLineItem()]);

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

  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTechNotes, setShowTechNotes] = useState(false);
  const [showTaskList, setShowTaskList] = useState(false);

  // AI rewrite state
  const [rewritingId, setRewritingId] = useState<string | null>(null);
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
    }
  }, [workOrder, editInvoice]);

  // ── Auto-save effect (debounced 2s) ──────────
  useEffect(() => {
    if (!userHasEdited.current) return;
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
  }, [propertyName, propertyAddress, woReference, completedDate, internalNotes, lineItems]);

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
    };
  }

  // ── AI rewrite handler ──────────
  async function handleAiRewrite(lineItemId: string) {
    const li = lineItems.find((l) => l.id === lineItemId);
    if (!li || !li.description.trim()) return;

    setRewritingId(lineItemId);
    try {
      const res = await fetch("/api/invoices/rewrite-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: li.description.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.rewritten) {
        userHasEdited.current = true;
        setLineItems((prev) =>
          prev.map((item) =>
            item.id === lineItemId ? { ...item, description: data.rewritten } : item
          )
        );
      }
    } catch (err) {
      console.error("AI rewrite failed:", err);
    } finally {
      setRewritingId(null);
    }
  }

  // ── Manual save / generate PDF ──────────
  async function handleSave(generatePdf: boolean) {
    setError(null);

    if (!propertyName.trim() || !propertyAddress.trim()) {
      setError("Property name and address are required");
      return;
    }

    if (!completedDate.trim()) {
      setError("Completed date is required before saving or printing the invoice.");
      return;
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

  return (
    <div className="animate-slide-up">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={isLoading}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <h3 className="text-lg font-semibold text-charcoal-900">
          {editInvoice ? `Edit ${editInvoice.invoice_code}` : "New Invoice"}
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

          <div className="rounded-xl border border-sand-200 bg-white overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[80px_1fr_60px_80px_48px_90px_36px] gap-2 px-3 py-2 bg-charcoal-50 border-b border-sand-200 text-[11px] font-semibold text-charcoal-400 uppercase tracking-wider">
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
                  className={`grid grid-cols-[80px_1fr_60px_80px_48px_90px_36px] gap-2 px-3 py-1.5 border-b border-charcoal-100 last:border-b-0 items-start ${
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
                      disabled={isLoading || rewritingId === li.id}
                      rows={2}
                      className={`w-full text-xs bg-transparent border border-sand-200 rounded-md px-3 py-2 resize-y leading-relaxed focus:outline-none focus:ring-2 focus:ring-terra-600/30 disabled:opacity-50 ${
                        li.description.trim().length > 3 ? "pr-10" : ""
                      }`}
                    />
                    {li.description.trim().length > 3 && (
                      <button
                        type="button"
                        onClick={() => handleAiRewrite(li.id)}
                        disabled={isLoading || rewritingId !== null}
                        className="absolute right-1 top-1 h-7 w-7 flex items-center justify-center text-purple-300 hover:text-purple-600 hover:bg-purple-50 disabled:hover:text-charcoal-300 disabled:hover:bg-transparent transition-colors rounded-md border border-transparent hover:border-purple-200"
                        title="AI rewrite for professional invoice voice"
                      >
                        {rewritingId === li.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                      </button>
                    )}
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
          <Button
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
          </Button>
        </div>
      </div>
    </div>
  );
}

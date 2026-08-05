"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  FileSpreadsheet,
  FileText,
  Download,
  Building2,
  Users,
  DollarSign,
  Home,
  Loader2,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

// ============================================
// Types (mirrors server types)
// ============================================

interface TenantRecord {
  tenantId: string;
  tenantName: string;
  moveInDate: string | null;
  moveOutDate: string | null;
  leaseStartDate: string | null;
  leaseEndDate: string | null;
  rent: number | null;
  status: string;
  isCurrent: boolean;
}

interface OwnerUnit {
  unitId: string;
  unitName: string | null;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  currentRent: number | null;
  tenantHistory: TenantRecord[];
}

interface OwnerProperty {
  propertyId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  propertyType: string;
  units: OwnerUnit[];
}

interface OwnerReportSummary {
  totalProperties: number;
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  totalMonthlyRent: number;
  avgRentPerUnit: number;
  longestTenancy: { tenantName: string; years: number } | null;
}

interface OwnerReport {
  ownerName: string;
  generatedAt: string;
  properties: OwnerProperty[];
  summary: OwnerReportSummary;
}

// ============================================
// Helpers
// ============================================

function fmt(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// ============================================
// Component
// ============================================

export function OwnerReportDashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [ownerNames, setOwnerNames] = useState<string[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);
  const [report, setReport] = useState<OwnerReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState<"pdf" | "excel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedProperties, setExpandedProperties] = useState<Set<string>>(new Set());

  // Search owners
  const searchOwners = useCallback(async (query: string) => {
    setSearchLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/owner?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setOwnerNames(data.owners || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setOwnerNames([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.length >= 2 || searchQuery === "") {
        searchOwners(searchQuery);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchOwners]);

  // Load initial owner list
  useEffect(() => {
    searchOwners("");
  }, [searchOwners]);

  // Generate report for selected owner
  const generateReport = async (ownerName: string) => {
    setSelectedOwner(ownerName);
    setReportLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/reports/owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_name: ownerName, format: "json" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Report generation failed");
      setReport(data);
      // Expand all properties by default
      setExpandedProperties(new Set(data.properties.map((p: OwnerProperty) => p.propertyId)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report generation failed");
    } finally {
      setReportLoading(false);
    }
  };

  // Export as PDF or Excel
  const exportReport = async (format: "pdf" | "excel") => {
    if (!selectedOwner) return;
    setExportLoading(format);
    try {
      const res = await fetch("/api/reports/owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_name: selectedOwner, format }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Export failed (${res.status})`);
      }

      const blob = await res.blob();
      const ext = format === "pdf" ? "pdf" : "xlsx";
      const fileName = `Owner_Report_${selectedOwner.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().split("T")[0]}.${ext}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportLoading(null);
    }
  };

  const toggleProperty = (propertyId: string) => {
    setExpandedProperties((prev) => {
      const next = new Set(prev);
      if (next.has(propertyId)) {
        next.delete(propertyId);
      } else {
        next.add(propertyId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-charcoal-500 hover:text-charcoal-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-display text-charcoal-900">Owner Reports</h1>
            <p className="text-sm text-charcoal-500 mt-1">
              Tenant history, rent timelines, and portfolio summaries by owner
            </p>
          </div>
        </div>
        {report && (
          <div className="flex gap-2">
            <button
              onClick={() => exportReport("excel")}
              disabled={!!exportLoading}
              className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {exportLoading === "excel" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-4 h-4" />
              )}
              Export Excel
            </button>
            <button
              onClick={() => exportReport("pdf")}
              disabled={!!exportLoading}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {exportLoading === "pdf" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileText className="w-4 h-4" />
              )}
              Export PDF
            </button>
          </div>
        )}
      </div>

      {/* Owner Search */}
      <div className="bg-white rounded-xl border border-sand-200 shadow-card p-6">
        <label className="block text-sm font-medium text-charcoal-600 mb-2">
          Search Owner
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Type an owner name..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-sand-300 rounded-lg text-charcoal-900 placeholder-charcoal-400 focus:outline-none focus:ring-2 focus:ring-terra-500 focus:border-transparent"
          />
          {searchLoading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-charcoal-500" />
          )}
        </div>

        {/* Owner list */}
        {ownerNames.length > 0 && (
          <div className="mt-3 max-h-60 overflow-y-auto space-y-1">
            {ownerNames.map((name) => (
              <button
                key={name}
                onClick={() => generateReport(name)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedOwner === name
                    ? "bg-terra-50 text-terra-700 border border-terra-200"
                    : "text-charcoal-600 hover:bg-sand-100"
                }`}
              >
                <Building2 className="w-3.5 h-3.5 inline mr-2 opacity-50" />
                {name}
              </button>
            ))}
          </div>
        )}

        {!searchLoading && ownerNames.length === 0 && searchQuery.length >= 2 && (
          <p className="mt-3 text-sm text-charcoal-400">
            No owners found matching &ldquo;{searchQuery}&rdquo;
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {reportLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-terra-500 mx-auto mb-3" />
            <p className="text-charcoal-500 text-sm">
              Building report for {selectedOwner}...
            </p>
            <p className="text-charcoal-400 text-xs mt-1">
              Fetching properties, tenants, and rent history from AppFolio
            </p>
          </div>
        </div>
      )}

      {/* Report */}
      {report && !reportLoading && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              icon={<Building2 className="w-5 h-5" />}
              label="Properties"
              value={String(report.summary.totalProperties)}
            />
            <SummaryCard
              icon={<Home className="w-5 h-5" />}
              label="Units"
              value={`${report.summary.occupiedUnits} / ${report.summary.totalUnits}`}
              sub={`${report.summary.vacantUnits} vacant`}
            />
            <SummaryCard
              icon={<DollarSign className="w-5 h-5" />}
              label="Monthly Income"
              value={fmt(report.summary.totalMonthlyRent)}
              accent
            />
            <SummaryCard
              icon={<Users className="w-5 h-5" />}
              label="Avg Rent/Unit"
              value={fmt(report.summary.avgRentPerUnit)}
            />
          </div>

          {report.summary.longestTenancy && (
            <p className="text-xs text-charcoal-400">
              Longest tenancy: {report.summary.longestTenancy.tenantName} ({report.summary.longestTenancy.years} years)
            </p>
          )}

          {/* Property Details */}
          <div className="space-y-4">
            {report.properties.map((prop) => (
              <PropertyCard
                key={prop.propertyId}
                property={prop}
                expanded={expandedProperties.has(prop.propertyId)}
                onToggle={() => toggleProperty(prop.propertyId)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================
// Sub-components
// ============================================

function SummaryCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        accent
          ? "bg-terra-50 border-terra-200"
          : "bg-white border-sand-200 shadow-card"
      }`}
    >
      <div className="flex items-center gap-2 text-charcoal-500 mb-2">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={`text-xl font-bold ${
          accent ? "text-terra-700" : "text-charcoal-900"
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-charcoal-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function PropertyCard({
  property,
  expanded,
  onToggle,
}: {
  property: OwnerProperty;
  expanded: boolean;
  onToggle: () => void;
}) {
  const totalRent = property.units.reduce((sum, u) => sum + (u.currentRent || 0), 0);
  const occupiedCount = property.units.filter((u) =>
    u.tenantHistory.some((t) => t.isCurrent)
  ).length;

  return (
    <div className="bg-white rounded-xl border border-sand-200 shadow-card overflow-hidden">
      {/* Property header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-sand-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-charcoal-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-charcoal-500" />
          )}
          <div>
            <h3 className="font-semibold text-charcoal-900">
              {property.address || property.name}
            </h3>
            <p className="text-xs text-charcoal-500 mt-0.5">
              {property.city}, {property.state} {property.zip}
              {property.propertyType && ` · ${property.propertyType}`}
              {` · ${property.units.length} unit(s)`}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-green-700">
            {fmt(totalRent)}/mo
          </p>
          <p className="text-xs text-charcoal-400">
            {occupiedCount}/{property.units.length} occupied
          </p>
        </div>
      </button>

      {/* Expanded: unit + tenant details */}
      {expanded && (
        <div className="border-t border-sand-200">
          {property.units.map((unit) => (
            <div key={unit.unitId} className="px-5 py-3 border-b border-sand-100 last:border-b-0">
              {/* Unit header (if multi-unit) */}
              {property.units.length > 1 && unit.unitName && (
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-green-700">
                    Unit: {unit.unitName}
                  </span>
                  <span className="text-xs text-charcoal-400">
                    {[
                      unit.bedrooms && `${unit.bedrooms}BR`,
                      unit.bathrooms && `${unit.bathrooms}BA`,
                      unit.sqft && `${unit.sqft.toLocaleString()} sqft`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              )}

              {/* Tenant history table */}
              {unit.tenantHistory.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-charcoal-400 uppercase tracking-wider">
                        <th className="text-left py-1 pr-3">Tenant</th>
                        <th className="text-left py-1 pr-3">Move-In</th>
                        <th className="text-left py-1 pr-3">Move-Out</th>
                        <th className="text-right py-1 pr-3">Rent</th>
                        <th className="text-left py-1 pr-3">Lease End</th>
                        <th className="text-left py-1">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unit.tenantHistory.map((t) => (
                        <tr
                          key={t.tenantId}
                          className={`border-t border-sand-100 ${
                            t.isCurrent ? "text-charcoal-900" : "text-charcoal-500"
                          }`}
                        >
                          <td className="py-1.5 pr-3 font-medium">
                            {t.tenantName}
                          </td>
                          <td className="py-1.5 pr-3">{fmtDate(t.moveInDate)}</td>
                          <td className="py-1.5 pr-3">{fmtDate(t.moveOutDate)}</td>
                          <td className="py-1.5 pr-3 text-right font-semibold">
                            {t.rent ? fmt(t.rent) : "—"}
                          </td>
                          <td className="py-1.5 pr-3">
                            {fmtDate(t.leaseEndDate)}
                          </td>
                          <td className="py-1.5">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                t.isCurrent
                                  ? "bg-green-50 text-green-800"
                                  : "bg-sand-100 text-charcoal-500"
                              }`}
                            >
                              {t.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-charcoal-400 italic">
                  No tenant records found
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

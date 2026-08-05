"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Table2,
  BarChartHorizontal,
  Plus,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CompsFilters } from "@/components/comps/CompsFilters";
import { CompsStatsCards } from "@/components/comps/CompsStatsCards";
import { CompsTable } from "@/components/comps/CompsTable";
import { CompsChart } from "@/components/comps/CompsChart";
import { AddCompForm } from "@/components/comps/AddCompForm";
import { RentometerWidget } from "@/components/comps/RentometerWidget";
import type {
  RentalComp,
  CompsFilter,
  CompsStats,
  TownStats,
  MarketBaseline,
  Town,
} from "@/types/comps";

interface CompsDashboardProps {
  userEmail: string;
  userName: string;
}

type View = "dashboard" | "add";
type DataView = "table" | "chart";

export function CompsDashboard({ userEmail, userName }: CompsDashboardProps) {
  const [view, setView] = useState<View>("dashboard");
  const [dataView, setDataView] = useState<DataView>("table");
  const [filter, setFilter] = useState<CompsFilter>(() => {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return { date_from: sixMonthsAgo.toISOString().split("T")[0] };
  });

  // Data state
  const [comps, setComps] = useState<RentalComp[]>([]);
  const [stats, setStats] = useState<CompsStats | null>(null);
  const [townStats, setTownStats] = useState<TownStats[]>([]);
  const [baselines, setBaselines] = useState<MarketBaseline[]>([]);
  const [loading, setLoading] = useState(true);

  // Convert a MarketBaseline into a pseudo-RentalComp for table display
  function baselineToComp(b: MarketBaseline): RentalComp {
    return {
      id: `baseline-${b.id}`,
      town: b.area_name as Town,
      address: `FY${b.data_year} Fair Market Rent — ${b.county} County`,
      zip_code: null,
      bedrooms: b.bedrooms,
      bathrooms: null,
      sqft: null,
      property_type: "Other",
      amenities: [],
      monthly_rent: b.fmr_rent || 0,
      rent_per_sqft: null,
      data_source: "hud_fmr",
      comp_date: `${b.data_year}-01-01`,
      external_id: null,
      rentometer_percentile: null,
      rentometer_cached_until: null,
      notes: `HUD Fair Market Rent for ${b.area_name} (${b.bedrooms}BR) — FY${b.data_year}`,
      created_by: "system",
      created_at: b.created_at,
      updated_at: b.updated_at,
    };
  }

  // Blend baselines into comps when HUD FMR filter is active
  const displayComps = useMemo(() => {
    const hudSelected = filter.data_sources?.includes("hud_fmr");
    if (!hudSelected) return comps;

    // Convert baselines to pseudo-comp rows
    let baselineComps = baselines
      .filter((b) => b.fmr_rent && b.fmr_rent > 0)
      .map(baselineToComp);

    // Apply town filter
    if (filter.towns?.length) {
      baselineComps = baselineComps.filter((c) =>
        filter.towns!.includes(c.town)
      );
    }

    // Apply bedroom filter
    if (filter.bedrooms?.length) {
      baselineComps = baselineComps.filter((c) =>
        filter.bedrooms!.includes(c.bedrooms)
      );
    }

    // Apply rent range filter
    if (filter.rent_min !== undefined) {
      baselineComps = baselineComps.filter(
        (c) => c.monthly_rent >= filter.rent_min!
      );
    }
    if (filter.rent_max !== undefined) {
      baselineComps = baselineComps.filter(
        (c) => c.monthly_rent <= filter.rent_max!
      );
    }

    // If ONLY hud_fmr selected, show only baselines
    const otherSources = (filter.data_sources || []).filter(
      (s) => s !== "hud_fmr"
    );
    if (otherSources.length === 0) {
      return baselineComps;
    }

    // Otherwise merge comps + baselines
    return [...comps, ...baselineComps];
  }, [comps, baselines, filter]);

  // Build query string from filter (strip hud_fmr since it's handled client-side)
  function buildQuery(f: CompsFilter): string {
    const params = new URLSearchParams();
    if (f.towns?.length) params.set("towns", f.towns.join(","));
    if (f.bedrooms?.length) params.set("bedrooms", f.bedrooms.join(","));
    if (f.property_types?.length)
      params.set("property_types", f.property_types.join(","));
    // Strip hud_fmr from API call — baselines are blended client-side
    const apiSources = f.data_sources?.filter((s) => s !== "hud_fmr");
    if (apiSources?.length) params.set("data_sources", apiSources.join(","));
    if (f.amenities?.length) params.set("amenities", f.amenities.join(","));
    if (f.date_from) params.set("date_from", f.date_from);
    if (f.date_to) params.set("date_to", f.date_to);
    if (f.rent_min !== undefined)
      params.set("rent_min", f.rent_min.toString());
    if (f.rent_max !== undefined)
      params.set("rent_max", f.rent_max.toString());
    return params.toString();
  }

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = buildQuery(filter);
      const [compsRes, statsRes] = await Promise.all([
        fetch(`/api/comps${qs ? `?${qs}` : ""}`),
        fetch(`/api/comps/stats${qs ? `?${qs}` : ""}`),
      ]);

      if (compsRes.ok) {
        const compsData = await compsRes.json();
        setComps(compsData.comps || []);
      }

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.stats || null);
        setTownStats(statsData.townStats || []);
        setBaselines(statsData.baselines || []);
      }
    } catch (err) {
      console.error("Failed to fetch comps data:", err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // Fetch on mount and when filter changes
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Delete handler (skip baseline pseudo-comps)
  async function handleDelete(id: string) {
    if (id.startsWith("baseline-")) return;
    if (!confirm("Delete this comp?")) return;
    try {
      const res = await fetch(`/api/comps/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error("Delete error:", err);
    }
  }

  // Add form view
  if (view === "add") {
    return (
      <div className="max-w-3xl mx-auto animate-slide-up">
        <AddCompForm
          onBack={() => setView("dashboard")}
          onSaved={() => {
            setView("dashboard");
            fetchData();
          }}
        />
      </div>
    );
  }

  // Main dashboard
  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
      {/* Header */}
      <PageHeader
        title="Rent Comparison Toolkit"
        className="mb-0"
        actions={
          <>
            <Link href="/comps/analysis">
              <Button
                size="sm"
                variant="outline"
                className="border-sand-200 text-charcoal-700 hover:bg-sand-50"
              >
                <FileText className="h-4 w-4 mr-1.5" />
                Rent Analysis
              </Button>
            </Link>
            <Button
              onClick={() => setView("add")}
              size="sm"
              className="bg-terra-500 hover:bg-terra-600 text-white shadow-sm transition-all duration-200"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Add Comp
            </Button>
          </>
        }
      />

      {/* Filters */}
      <CompsFilters filter={filter} onChange={setFilter} />

      {/* Stats Cards */}
      <CompsStatsCards stats={stats} baselines={baselines} loading={loading} />

      {/* Data View */}
      <Tabs value={dataView} onValueChange={(v) => setDataView(v as DataView)}>
        <TabsList>
          <TabsTrigger value="table">
            <Table2 className="h-3.5 w-3.5" />
            Table
          </TabsTrigger>
          <TabsTrigger value="chart">
            <BarChartHorizontal className="h-3.5 w-3.5" />
            Chart
          </TabsTrigger>
        </TabsList>
        <TabsContent value="table">
          <CompsTable comps={displayComps} loading={loading} onDelete={handleDelete} />
        </TabsContent>
        <TabsContent value="chart">
          <CompsChart
            townStats={townStats}
            baselines={baselines}
            loading={loading}
            bedrooms={filter.bedrooms?.[0]}
          />
        </TabsContent>
      </Tabs>

      {/* Rentometer Widget */}
      <RentometerWidget onCompCreated={fetchData} />

      {/* Footer info */}
      {!loading && displayComps.length > 0 && (
        <p className="text-center text-[10px] text-charcoal-300 pb-8">
          Data from AppFolio, Rentometer, HUD FMR, and manual entry •{" "}
          {displayComps.length} records loaded
        </p>
      )}
    </div>
  );
}

"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { standardRentNotes } from "@/lib/rent-notes-template";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  ChevronRight,
  Clock,
  Download,
  Edit3,
  FileText,
  Loader2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PropertyInput } from "@/components/comps/PropertyInput";
import {
  AnalysisResults,
  ReportReady,
} from "@/components/comps/AnalysisResults";
import type {
  SubjectProperty,
  RentAnalysis,
  CompetingListing,
  SavedRentAnalysis,
} from "@/types/comps";

interface RentAnalysisWizardProps {
  userEmail: string;
  userName: string;
}

type Step = "input" | "results" | "report";

function fmt(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export function RentAnalysisWizard({
  userEmail,
  userName,
}: RentAnalysisWizardProps) {
  const [step, setStep] = useState<Step>("input");
  const [analyzing, setAnalyzing] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [zillowLoading, setZillowLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data
  const [subject, setSubject] = useState<SubjectProperty | null>(null);
  const [analysis, setAnalysis] = useState<RentAnalysis | null>(null);
  const [competingListings, setCompetingListings] = useState<CompetingListing[]>([]);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [rentOverride, setRentOverride] = useState("");
  const [managerNotes, setManagerNotes] = useState("");
  // The standard notes we auto-filled, so a later data refresh (e.g. Zillow) can
  // update them — but never text staff typed or edited.
  const autoNotes = useRef<string | null>(null);
  const autoFillNotes = (next: RentAnalysis) =>
    setManagerNotes((current) => {
      if (current.trim() && current !== autoNotes.current) return current;
      autoNotes.current = standardRentNotes(next);
      return autoNotes.current;
    });

  // Saved reports
  const [savedReports, setSavedReports] = useState<SavedRentAnalysis[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Fetch saved reports on mount
  const fetchSavedReports = useCallback(async () => {
    try {
      const res = await fetch("/api/comps/analyses");
      if (res.ok) {
        const data = await res.json();
        setSavedReports(data.analyses || []);
      }
    } catch (err) {
      console.error("Failed to fetch saved reports:", err);
    } finally {
      setLoadingReports(false);
    }
  }, []);

  useEffect(() => {
    fetchSavedReports();
  }, [fetchSavedReports]);

  // Step 1: Analyze property
  async function handlePropertySubmit(subjectProp: SubjectProperty) {
    setSubject(subjectProp);
    setAnalyzing(true);
    setError(null);

    try {
      const res = await fetch("/api/comps/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subjectProp,
          competing_listings: [],
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setAnalysis(data.analysis);
      autoFillNotes(data.analysis);
      setStep("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  // Search Zillow for competing listings
  async function handleSearchZillow() {
    if (!subject || !analysis) return;
    setZillowLoading(true);

    try {
      const res = await fetch(
        `/api/comps/zillow?town=${encodeURIComponent(subject.town)}&bedrooms=${subject.bedrooms}`
      );
      const data = await res.json();

      if (data.listings && data.listings.length > 0) {
        setCompetingListings(data.listings);

        // Re-generate analysis with Zillow data
        const reportRes = await fetch("/api/comps/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject,
            competing_listings: data.listings,
          }),
        });

        const reportData = await reportRes.json();
        if (reportRes.ok) {
          setAnalysis(reportData.analysis);
          autoFillNotes(reportData.analysis);
        }
      } else if (data.zillow_url) {
        window.open(data.zillow_url, "_blank");
      }
    } catch (err) {
      console.error("Zillow search failed:", err);
    } finally {
      setZillowLoading(false);
    }
  }

  // Generate final PDF report
  async function handleGenerateReport() {
    if (!subject || !analysis) return;
    setGeneratingReport(true);
    setError(null);

    try {
      const res = await fetch("/api/comps/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          competing_listings: competingListings,
          prepared_for: ownerName.trim() || undefined,
          recommended_rent_override: rentOverride ? Number(rentOverride) : undefined,
          owner_email: ownerEmail.trim() || undefined,
          manager_notes: managerNotes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setAnalysis(data.analysis);
      setPdfBase64(data.pdf_base64);
      setDownloadUrl(data.download_url || null);
      setShortUrl(data.short_url || null);
      setStep("report");
      // Refresh saved reports list
      fetchSavedReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report generation failed");
    } finally {
      setGeneratingReport(false);
    }
  }

  // Load a saved report for editing
  async function handleEditReport(saved: SavedRentAnalysis) {
    setEditingId(saved.id);
    const analysisData = saved.analysis_json;
    setSubject(analysisData.subject);
    setAnalysis(analysisData);
    setCompetingListings(analysisData.competing_listings || []);
    setOwnerName(saved.prepared_for || "");
    setOwnerEmail(saved.owner_email || "");
    setRentOverride(saved.recommended_rent_override ? String(saved.recommended_rent_override) : "");
    // A saved report keeps exactly the notes it was sent with.
    autoNotes.current = null;
    setManagerNotes(saved.manager_notes || "");
    setPdfBase64(null);
    setDownloadUrl(null);
    setShortUrl(saved.short_url || null);
    setError(null);
    setStep("results");
  }

  // Reprint a saved report (regenerate PDF with same data)
  async function handleReprintReport(saved: SavedRentAnalysis) {
    setEditingId(saved.id);
    setError(null);

    try {
      const res = await fetch(`/api/comps/analyses/${saved.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate_pdf: true }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSubject(saved.analysis_json.subject);
      setAnalysis(data.analysis.analysis_json);
      setPdfBase64(data.pdf_base64);
      setDownloadUrl(null);
      setShortUrl(saved.short_url || null);
      setOwnerName(saved.prepared_for || "");
      setOwnerEmail(saved.owner_email || "");
      setRentOverride(saved.recommended_rent_override ? String(saved.recommended_rent_override) : "");
      setStep("report");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reprint failed");
    }
  }

  // Delete a saved report
  async function handleDeleteReport(id: string) {
    if (!confirm("Delete this saved report?")) return;
    try {
      const res = await fetch(`/api/comps/analyses/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSavedReports((prev) => prev.filter((r) => r.id !== id));
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }

  // Reset to start
  function handleStartOver() {
    setStep("input");
    setSubject(null);
    setAnalysis(null);
    setCompetingListings([]);
    setPdfBase64(null);
    setDownloadUrl(null);
    setShortUrl(null);
    setOwnerName("");
    setOwnerEmail("");
    setRentOverride("");
    setManagerNotes("");
    autoNotes.current = null;
    setEditingId(null);
    setError(null);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/comps">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Comps
            </Button>
          </Link>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-charcoal-900 tracking-tight">
                Rent Analysis Report
              </h2>
              <p className="text-xs text-charcoal-400">
                Generate branded reports for property owners
              </p>
            </div>
          </div>
        </div>

        {step !== "input" && (
          <Button
            onClick={handleStartOver}
            variant="ghost"
            size="sm"
            className="text-charcoal-400 hover:text-charcoal-600"
          >
            Start Over
          </Button>
        )}
      </div>

      {/* Progress indicator */}
      <div className="flex items-center gap-2 px-1">
        {[
          { key: "input", label: "Property" },
          { key: "results", label: "Analysis" },
          { key: "report", label: "Report" },
        ].map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 && (
              <ChevronRight className="h-3 w-3 text-charcoal-300 flex-shrink-0" />
            )}
            <span
              className={`text-xs font-medium px-2.5 py-1 rounded-full transition-all duration-200 ${
                step === s.key
                  ? "bg-terra-100 text-terra-700"
                  : ["input", "results", "report"].indexOf(step) >
                    ["input", "results", "report"].indexOf(s.key)
                  ? "text-terra-500"
                  : "text-charcoal-300"
              }`}
            >
              {s.label}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Steps */}
      {step === "input" && (
        <>
          <PropertyInput onSubmit={handlePropertySubmit} loading={analyzing} />

          {/* Saved Reports List */}
          <div className="bg-white rounded-xl border border-sand-200 shadow-card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-sand-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-charcoal-400" />
                <h3 className="text-sm font-semibold text-charcoal-800">
                  Saved Reports
                </h3>
              </div>
              {savedReports.length > 0 && (
                <span className="text-[11px] text-charcoal-400">
                  {savedReports.length} report{savedReports.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {loadingReports ? (
              <div className="p-8 text-center">
                <Loader2 className="h-5 w-5 animate-spin text-charcoal-300 mx-auto" />
              </div>
            ) : savedReports.length === 0 ? (
              <div className="p-8 text-center text-sm text-charcoal-400">
                No saved reports yet. Generate your first analysis above.
              </div>
            ) : (
              <div className="divide-y divide-sand-100">
                {savedReports.map((report) => (
                  <div
                    key={report.id}
                    className="px-5 py-3 flex items-center justify-between hover:bg-sand-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-charcoal-900 truncate">
                          {report.address}
                        </p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-sand-100 text-charcoal-500 flex-shrink-0">
                          {report.town}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-charcoal-500">
                          {report.bedrooms} BR &middot; {report.property_type}
                        </span>
                        <span className="text-xs font-medium text-terra-600">
                          {report.recommended_rent_override
                            ? fmt(report.recommended_rent_override)
                            : `${fmt(report.recommended_rent_low)} – ${fmt(report.recommended_rent_high)}`}
                          /mo
                        </span>
                        {report.prepared_for && (
                          <span className="text-[10px] text-charcoal-400">
                            for {report.prepared_for}
                          </span>
                        )}
                        <span className="text-[10px] text-charcoal-300">
                          {formatDate(report.created_at)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0 ml-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-charcoal-400 hover:text-blue-600"
                        onClick={() => handleEditReport(report)}
                        title="Edit & regenerate"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-charcoal-400 hover:text-terra-600"
                        onClick={() => handleReprintReport(report)}
                        title="Reprint PDF"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-charcoal-400 hover:text-red-600"
                        onClick={() => handleDeleteReport(report.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {step === "results" && analysis && (
        <AnalysisResults
          analysis={analysis}
          onGenerateReport={handleGenerateReport}
          onSearchZillow={handleSearchZillow}
          generatingReport={generatingReport}
          zillowLoading={zillowLoading}
          ownerName={ownerName}
          ownerEmail={ownerEmail}
          onOwnerNameChange={setOwnerName}
          onOwnerEmailChange={setOwnerEmail}
          rentOverride={rentOverride}
          onRentOverrideChange={setRentOverride}
          managerNotes={managerNotes}
          onManagerNotesChange={setManagerNotes}
        />
      )}

      {step === "report" && analysis && pdfBase64 && (
        <ReportReady
          analysis={analysis}
          pdfBase64={pdfBase64}
          downloadUrl={downloadUrl}
          shortUrl={shortUrl}
          ownerName={ownerName}
          ownerEmail={ownerEmail}
        />
      )}

      {/* Footer */}
      <p className="text-center text-[10px] text-charcoal-300 pb-8">
        Powered by AppFolio, RentCast and HUD Fair Market Rent data
      </p>
    </div>
  );
}

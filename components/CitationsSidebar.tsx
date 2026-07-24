"use client";

import React, { useState } from "react";
import { BookOpen, PanelRightClose, Scale, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Source } from "@/components/Message";

interface CitationsSidebarProps {
  sources: Source[];
  highlightedCitation: number | null;
  onCitationClick: (index: number) => void;
}

export function CitationsSidebar({
  sources,
  highlightedCitation,
  onCitationClick,
}: CitationsSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);

  if (isCollapsed) {
    return (
      <div className="w-12 border-l border-sand-200 flex flex-col items-center py-3 bg-white shrink-0">
        <div className="relative group">
          <button
            onClick={() => setIsCollapsed(false)}
            className="p-2 rounded-lg text-charcoal-400 hover:text-charcoal-600 hover:bg-sand-100 transition-colors mb-3"
          >
            <Scale className="h-5 w-5" />
            {sources.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-terra-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {sources.length}
              </span>
            )}
          </button>
          <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-charcoal-900 text-white text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
            Sources
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-64 border-l border-sand-200 flex flex-col bg-white shrink-0">
      {/* Header */}
      <div className="h-14 px-3 border-b border-sand-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-terra-500" />
          <span className="text-xs font-semibold text-charcoal-500 uppercase tracking-wider">Sources</span>
          {sources.length > 0 && (
            <span className="text-2xs px-1.5 py-0.5 bg-terra-50 text-terra-600 rounded font-bold">
              {sources.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setIsCollapsed(true)}
          className="p-1.5 rounded-lg text-charcoal-400 hover:text-charcoal-600 hover:bg-sand-100 transition-colors"
          title="Collapse"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {/* Sources List */}
      <div className="flex-1 overflow-y-auto p-3">
        {sources.length === 0 ? (
          <div className="text-center py-12 px-4">
            <BookOpen className="h-6 w-6 mx-auto text-charcoal-200 mb-2" />
            <p className="text-xs text-charcoal-400">No sources yet</p>
            <p className="text-2xs text-charcoal-300 mt-1">
              Ask a question to see ORS 90 and SOP citations
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sources.map((source, index) => (
              <button
                key={source.id}
                id={`citation-${index + 1}`}
                onClick={() => onCitationClick(index)}
                className={cn(
                  "w-full text-left p-3 rounded-lg transition-all duration-200",
                  highlightedCitation === index
                    ? "bg-terra-50 border border-terra-300 shadow-sm"
                    : "bg-sand-50 border border-transparent hover:border-sand-200 hover:bg-sand-100"
                )}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={cn(
                      "flex items-center justify-center w-6 h-6 rounded-md text-xs font-bold shrink-0",
                      highlightedCitation === index
                        ? "bg-terra-500 text-white"
                        : "bg-sand-200 text-charcoal-600"
                    )}
                  >
                    {index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-charcoal-800 leading-tight">
                      {source.title}
                    </p>
                    {source.section && (
                      <p className="text-2xs text-terra-600 mt-1 font-medium">
                        ORS {source.section}
                      </p>
                    )}
                  </div>
                </div>

                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="mt-2 flex items-center gap-1 text-2xs text-charcoal-400 hover:text-terra-600 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  View full text
                </a>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer hint */}
      {sources.length > 0 && (
        <div className="px-3 py-2.5 border-t border-sand-200">
          <p className="text-2xs text-charcoal-300 text-center">
            Click numbers in chat to highlight
          </p>
        </div>
      )}
    </div>
  );
}

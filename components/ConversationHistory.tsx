"use client";

import React, { useState } from "react";
import { MessageSquarePlus, Clock, Trash2, PanelLeftClose, History } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  user_email: string;
  user_name?: string;
}

interface ConversationHistoryProps {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  currentUserEmail?: string;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  isLoading: boolean;
  /** Start expanded (e.g. when hosted in the chat panel's history popover). */
  defaultExpanded?: boolean;
}

function getInitials(name?: string, email?: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  }
  if (email) {
    const local = email.split('@')[0];
    return local.substring(0, 2).toUpperCase();
  }
  return '??';
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } else if (days === 1) {
    return 'Yesterday';
  } else if (days < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  } else {
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  }
}

export function ConversationHistory({
  conversations,
  activeConversationId,
  currentUserEmail,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  isLoading,
  defaultExpanded = false,
}: ConversationHistoryProps) {
  const [isCollapsed, setIsCollapsed] = useState(!defaultExpanded);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Delete this conversation? This cannot be undone.')) {
      setDeletingId(id);
      try {
        await onDeleteConversation(id);
      } finally {
        setDeletingId(null);
      }
    }
  };

  if (isCollapsed) {
    return (
      <div className="w-12 border-r border-sand-200 flex flex-col items-center py-3 bg-white shrink-0">
        <div className="relative group">
          <button
            onClick={() => setIsCollapsed(false)}
            className="p-2 rounded-lg text-charcoal-400 hover:text-charcoal-600 hover:bg-sand-100 transition-colors mb-2"
          >
            <History className="h-5 w-5" />
          </button>
          <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-charcoal-900 text-white text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
            History
          </span>
        </div>
        <div className="relative group">
          <button
            onClick={onNewConversation}
            className="p-2 rounded-lg text-charcoal-400 hover:text-terra-600 hover:bg-terra-50 transition-colors"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
          <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-charcoal-900 text-white text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
            New chat
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-60 border-r border-sand-200 flex flex-col bg-white shrink-0">
      {/* Header */}
      <div className="h-14 px-3 border-b border-sand-200 flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold text-charcoal-500 uppercase tracking-wider">History</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onNewConversation}
            className="p-1.5 rounded-lg text-charcoal-400 hover:text-terra-600 hover:bg-terra-50 transition-colors"
            title="New conversation"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 rounded-lg text-charcoal-400 hover:text-charcoal-600 hover:bg-sand-100 transition-colors"
            title="Collapse"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-charcoal-300 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-12 px-4">
            <Clock className="h-6 w-6 mx-auto text-charcoal-200 mb-2" />
            <p className="text-xs text-charcoal-400">No conversations yet</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {conversations.map((conversation) => {
              const initials = getInitials(conversation.user_name, conversation.user_email);
              const isOwner = currentUserEmail === conversation.user_email;
              const isActive = activeConversationId === conversation.id;

              return (
                <button
                  key={conversation.id}
                  onClick={() => onSelectConversation(conversation.id)}
                  className={cn(
                    "group relative w-full text-left px-3 py-2.5 rounded-lg transition-all duration-150",
                    isActive
                      ? "bg-sand-100 text-charcoal-900"
                      : "text-charcoal-600 hover:bg-sand-50 hover:text-charcoal-800"
                  )}
                >
                  <p className={cn(
                    "text-[13px] font-medium truncate pr-6",
                    isActive ? "text-charcoal-900" : "text-charcoal-700"
                  )}>
                    {conversation.title}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span
                      className={cn(
                        "inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold shrink-0",
                        isOwner
                          ? "bg-terra-100 text-terra-600"
                          : "bg-charcoal-100 text-charcoal-500"
                      )}
                      title={conversation.user_name || conversation.user_email}
                    >
                      {initials}
                    </span>
                    <span className="text-2xs text-charcoal-400">
                      {formatDate(conversation.updated_at)}
                    </span>
                  </div>

                  {/* Delete button */}
                  {isOwner && (
                    <span
                      role="button"
                      onClick={(e) => handleDelete(e, conversation.id)}
                      className={cn(
                        "absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-all",
                        "text-charcoal-300 hover:text-red-500 hover:bg-red-50",
                        deletingId === conversation.id && "opacity-100"
                      )}
                      title="Delete"
                    >
                      {deletingId === conversation.id ? (
                        <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

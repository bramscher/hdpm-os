"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Paperclip, FileText, Trash2, ArrowUp, History } from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Message, Source } from "@/components/Message";
import { ConversationHistory, ConversationSummary } from "@/components/ConversationHistory";
import { CitationsSidebar } from "@/components/CitationsSidebar";
import { APP_EMBEDS, matchIntent, sopUrlToAppKey, type AppEmbedKey } from "@/lib/canvas-routes";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  attachment?: {
    type: "text" | "pdf";
    name: string;
    preview: string;
    fullContent?: string;
  };
  sender_name?: string;
  sender_email?: string;
  created_at?: string;
}

interface Attachment {
  type: "text" | "pdf";
  name: string;
  content: string;
  preview: string;
}

interface ChatWindowProps {
  isOpen: boolean;
  onClose: () => void;
  onMinimize: () => void;
  /** 'full' = legacy full-page overlay; 'panel' = left panel of the agent interface. */
  variant?: "full" | "panel";
  /** Panel mode: open a cited source in the canvas. */
  onOpenSource?: (source: Source) => void;
  /** Panel mode: display an app view in the canvas. */
  onOpenApp?: (appKey: AppEmbedKey) => void;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi! I'm the **HDPM Knowledge Chat**. I can help with:\n\n• **Oregon landlord-tenant law** (complete ORS Chapter 90, 163 sections)\n• **HDPM SOPs & procedures** (move-in/move-out, inspections, maintenance, key management, screening, and more from the Notion SOP library)\n• **Security deposits**, late fees, eviction notices and timelines\n• **How to use HDPM-OS** (board, inspections, invoices, Craigslist tool)\n\nAnswers cite their sources — click a citation to open the ORS section or the Notion SOP.\n\nWhat would you like to know?",
};

export function ChatWindow({
  isOpen,
  onClose,
  onMinimize, // eslint-disable-line @typescript-eslint/no-unused-vars
  variant = "full",
  onOpenSource,
  onOpenApp,
}: ChatWindowProps) {
  const { data: session } = useSession();
  const isPanel = variant === "panel";
  const [showHistory, setShowHistory] = useState(false);

  // Conversation state
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isFirstMessage, setIsFirstMessage] = useState(true);

  // Message state
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);

  // Attachment state
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [showPasteArea, setShowPasteArea] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>("");

  // Citations state
  const [highlightedCitation, setHighlightedCitation] = useState<number | null>(null);

  // Get all sources from the latest assistant message
  const currentSources = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && messages[i].sources && messages[i].sources!.length > 0) {
        return messages[i].sources!;
      }
    }
    return [];
  }, [messages]);

  const handleCitationClick = (index: number) => {
    setHighlightedCitation(index);
    setTimeout(() => setHighlightedCitation(null), 3000);
  };

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch conversations list
  const fetchConversations = useCallback(async () => {
    try {
      const response = await fetch("/api/conversations");
      if (response.ok) {
        const data = await response.json();
        setConversations(data.conversations);
      }
    } catch (error) {
      console.error("Error fetching conversations:", error);
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user?.email) {
      fetchConversations();
    }
  }, [session?.user?.email, fetchConversations]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Save message to database
  const saveMessage = async (
    conversationId: string,
    role: "user" | "assistant",
    content: string,
    sources?: Source[],
    attachment?: ChatMessage["attachment"]
  ) => {
    try {
      await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, content, sources, attachment }),
      });
    } catch (error) {
      console.error("Error saving message:", error);
    }
  };

  const generateTitle = async (conversationId: string, firstMessage: string, hasAttachment: boolean, attachmentName?: string) => {
    try {
      const response = await fetch(`/api/conversations/${conversationId}/generate-title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstMessage, hasAttachment, attachmentName }),
      });

      if (response.ok) {
        const data = await response.json();
        setConversations((prev) =>
          prev.map((conv) =>
            conv.id === conversationId ? { ...conv, title: data.title } : conv
          )
        );
      }
    } catch (error) {
      console.error("Error generating title:", error);
    }
  };

  const handleNewConversation = async () => {
    setActiveConversationId(null);
    setMessages([WELCOME_MESSAGE]);
    setIsFirstMessage(true);
    setInput("");
    setAttachment(null);
    setShowPasteArea(false);
    setPasteText("");
  };

  const handleSelectConversation = async (id: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/conversations/${id}`);
      if (response.ok) {
        const data = await response.json();
        const loadedMessages: ChatMessage[] = data.conversation.messages.map((msg: {
          id: string;
          role: "user" | "assistant";
          content: string;
          sources?: Source[];
          attachment?: ChatMessage["attachment"];
          sender_name?: string;
          sender_email?: string;
          created_at?: string;
        }) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          sources: msg.sources || undefined,
          attachment: msg.attachment || undefined,
          sender_name: msg.sender_name,
          sender_email: msg.sender_email,
          created_at: msg.created_at,
        }));

        if (loadedMessages.length === 0) {
          loadedMessages.unshift(WELCOME_MESSAGE);
        }

        setMessages(loadedMessages);
        setActiveConversationId(id);
        setIsFirstMessage(false);
      }
    } catch (error) {
      console.error("Error loading conversation:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((conv) => conv.id !== id));
      if (activeConversationId === id) {
        handleNewConversation();
      }
    } catch (error) {
      console.error("Error deleting conversation:", error);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      alert("Please upload a PDF file");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("File size must be less than 10MB");
      return;
    }

    setIsUploading(true);
    setUploadStatus("Extracting text from PDF...");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/parse-pdf", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Failed to parse PDF");
      }

      const { text, method } = await response.json();

      if (method === "ocr") {
        setUploadStatus("OCR complete!");
      }

      const preview = text.substring(0, 200) + (text.length > 200 ? "..." : "");

      setAttachment({
        type: "pdf",
        name: file.name + (method === "ocr" ? " (OCR)" : ""),
        content: text,
        preview,
      });
      setShowPasteArea(false);
    } catch (error) {
      console.error("PDF upload error:", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      alert(`PDF parsing failed: ${errorMsg}`);
    } finally {
      setIsUploading(false);
      setUploadStatus("");
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handlePasteSubmit = () => {
    if (!pasteText.trim()) return;

    const preview = pasteText.substring(0, 200) + (pasteText.length > 200 ? "..." : "");
    setAttachment({
      type: "text",
      name: "Pasted Email/Text",
      content: pasteText,
      preview,
    });
    setPasteText("");
    setShowPasteArea(false);
  };

  const clearAttachment = () => {
    setAttachment(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = input.trim();

    if (!trimmedInput) return;
    if (isLoading) return;

    // "show me the board" — steer the canvas immediately; the answer still streams.
    if (isPanel && onOpenApp) {
      const intent = matchIntent(trimmedInput);
      if (intent) onOpenApp(intent);
    }

    const currentAttachment = attachment ? { ...attachment } : null;
    let conversationId = activeConversationId;

    if (isFirstMessage || !conversationId) {
      try {
        const response = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "New Conversation", userName: session?.user?.name }),
        });

        if (response.ok) {
          const data = await response.json();
          conversationId = data.conversation.id;
          setActiveConversationId(conversationId);
          setConversations((prev) => [data.conversation, ...prev]);

          if (conversationId) {
            generateTitle(
              conversationId,
              trimmedInput,
              !!currentAttachment,
              currentAttachment?.name
            );
          }
        }
      } catch (error) {
        console.error("Error creating conversation:", error);
      }
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmedInput,
      attachment: currentAttachment
        ? {
            type: currentAttachment.type,
            name: currentAttachment.name,
            preview: currentAttachment.preview,
            fullContent: currentAttachment.content,
          }
        : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setAttachment(null);
    setIsLoading(true);
    setIsFirstMessage(false);

    if (conversationId) {
      saveMessage(conversationId, "user", trimmedInput, undefined, userMessage.attachment);
    }

    const assistantMessageId = `assistant-${Date.now()}`;
    let streamedContent = "";
    let streamedSources: Source[] = [];

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmedInput,
          documentContent: currentAttachment?.content,
          documentName: currentAttachment?.name,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get response");
      }

      setStreamingMessageId(assistantMessageId);
      setMessages((prev) => [
        ...prev,
        { id: assistantMessageId, role: "assistant", content: "", sources: [] },
      ]);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body");
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "sources") {
                streamedSources = data.sources;
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id === assistantMessageId) {
                      return { ...msg, sources: streamedSources };
                    }
                    return msg;
                  })
                );
              } else if (data.type === "text") {
                streamedContent += data.text;
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id === assistantMessageId) {
                      return { ...msg, content: streamedContent };
                    }
                    return msg;
                  })
                );
              }
            } catch {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }

      if (conversationId && streamedContent) {
        saveMessage(conversationId, "assistant", streamedContent, streamedSources);
      }

      setConversations((prev) => {
        const updated = prev.map((conv) =>
          conv.id === conversationId
            ? { ...conv, updated_at: new Date().toISOString() }
            : conv
        );
        return updated.sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
      });
    } catch (error) {
      console.error("Chat error:", error);
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content:
          "I'm sorry, I encountered an error processing your request. Please try again.",
      };
      setMessages((prev) => {
        const filtered = prev.filter((msg) => msg.id !== assistantMessageId);
        return [...filtered, errorMessage];
      });
    } finally {
      setIsLoading(false);
      setStreamingMessageId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "flex overflow-hidden",
        isPanel ? "relative h-full w-full bg-white" : "h-screen bg-sand-50"
      )}
    >
      {/* Conversation History Sidebar (inline in full mode only) */}
      {!isPanel && (
        <ConversationHistory
          conversations={conversations}
          activeConversationId={activeConversationId}
          currentUserEmail={session?.user?.email || undefined}
          onSelectConversation={handleSelectConversation}
          onNewConversation={handleNewConversation}
          onDeleteConversation={handleDeleteConversation}
          isLoading={isLoadingConversations}
        />
      )}

      {/* Panel mode: history as a popover over the chat */}
      {isPanel && showHistory && (
        <div className="absolute left-3 top-16 bottom-24 z-30 flex overflow-hidden rounded-xl border border-sand-200 bg-white shadow-card-hover">
          <ConversationHistory
            conversations={conversations}
            activeConversationId={activeConversationId}
            currentUserEmail={session?.user?.email || undefined}
            onSelectConversation={(id) => {
              handleSelectConversation(id);
              setShowHistory(false);
            }}
            onNewConversation={() => {
              handleNewConversation();
              setShowHistory(false);
            }}
            onDeleteConversation={handleDeleteConversation}
            isLoading={isLoadingConversations}
            defaultExpanded
          />
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Minimal header */}
        <div className="flex items-center justify-between px-6 h-14 border-b border-sand-200 bg-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
            <h2 className="text-sm font-semibold text-charcoal-900 tracking-tight truncate">
              HDPM Knowledge Chat
            </h2>
            {!isPanel && (
              <span className="text-xs text-charcoal-400 hidden sm:inline">
                ORS Chapter 90 &middot; Notion SOP library
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isPanel && (
              <button
                onClick={() => setShowHistory((v) => !v)}
                className={cn(
                  "p-1.5 rounded-lg transition-colors",
                  showHistory
                    ? "text-terra-600 bg-terra-50"
                    : "text-charcoal-400 hover:text-charcoal-700 hover:bg-sand-100"
                )}
                title="Conversation history"
              >
                <History className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className={cn(
                "p-1.5 rounded-lg text-charcoal-400 hover:text-charcoal-700 hover:bg-sand-100 transition-colors",
                isPanel && "lg:hidden"
              )}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto">
            {messages.map((message, index) => {
              let relatedDocument = undefined;
              if (message.role === "assistant" && index > 0) {
                for (let i = index - 1; i >= 0; i--) {
                  if (messages[i].role === "user" && messages[i].attachment) {
                    relatedDocument = messages[i].attachment;
                    break;
                  }
                }
              }

              return (
                <React.Fragment key={message.id}>
                  <Message
                    role={message.role}
                    content={message.content}
                    sources={message.sources}
                    isStreaming={message.id === streamingMessageId}
                    attachment={message.attachment}
                    relatedDocument={relatedDocument}
                    onCitationClick={(i) => {
                      handleCitationClick(i);
                      // In panel mode a citation click also opens that source
                      // in the canvas (indices are per-message, 0-based).
                      if (isPanel && message.sources?.[i]) {
                        onOpenSource?.(message.sources[i]);
                      }
                    }}
                    showInlineSources={false}
                    senderName={message.sender_name}
                    senderEmail={message.sender_email}
                    createdAt={message.created_at}
                  />
                  {isPanel &&
                    message.role === "assistant" &&
                    !!message.sources?.length &&
                    message.id !== streamingMessageId && (
                      <SourcePillsRow
                        sources={message.sources}
                        onOpenSource={onOpenSource}
                        onOpenApp={onOpenApp}
                      />
                    )}
                </React.Fragment>
              );
            })}
          </div>
        </ScrollArea>

        {/* Paste Area */}
        {showPasteArea && (
          <div className="max-w-3xl mx-auto w-full px-6 pb-2">
            <div className="p-4 bg-white border border-sand-200 rounded-xl shadow-card">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-charcoal-800">
                  Paste Email or Correspondence
                </span>
                <button
                  onClick={() => {
                    setShowPasteArea(false);
                    setPasteText("");
                  }}
                  className="p-1 rounded-md text-charcoal-400 hover:text-charcoal-600 hover:bg-sand-100 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste email content, tenant letter, or any text you want analyzed..."
                className="w-full h-32 p-3 text-sm border border-sand-200 bg-sand-50 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-terra-500/30 focus:border-terra-400 transition-all placeholder:text-charcoal-300"
              />
              <div className="flex justify-end mt-3">
                <Button
                  onClick={handlePasteSubmit}
                  disabled={!pasteText.trim()}
                  size="sm"
                  className="bg-charcoal-900 hover:bg-charcoal-800 text-white rounded-lg"
                >
                  Attach Text
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-sand-200 bg-white px-6 py-4 shrink-0">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
            {/* Upload Progress */}
            {isUploading && (
              <div className="mb-3 p-3 bg-terra-50 border border-terra-200 rounded-lg flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-terra-100 flex items-center justify-center shrink-0">
                  <div className="w-4 h-4 border-2 border-terra-600 border-t-transparent rounded-full animate-spin" />
                </div>
                <div className="flex-1">
                  <span className="text-sm font-medium text-terra-800">
                    {uploadStatus || "Processing PDF..."}
                  </span>
                  <p className="text-xs text-terra-600 mt-0.5">
                    Scanned PDFs use AI vision to extract text
                  </p>
                </div>
              </div>
            )}

            {/* Attachment Preview */}
            {attachment && !isUploading && (
              <div className="mb-3 p-3 bg-sand-50 border border-sand-200 rounded-lg flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-terra-100 flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-terra-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-charcoal-800 truncate">
                      {attachment.name}
                    </span>
                    <span className="text-2xs px-1.5 py-0.5 bg-terra-100 text-terra-700 rounded font-medium">
                      {attachment.type === "pdf" ? "PDF" : "Text"}
                    </span>
                  </div>
                  <p className="text-xs text-charcoal-400 mt-1 line-clamp-1">{attachment.preview}</p>
                </div>
                <button
                  onClick={clearAttachment}
                  className="p-1.5 rounded-md text-charcoal-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <div className="flex items-end gap-2">
              {/* Attachment buttons */}
              <div className="flex gap-1 pb-0.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading || isUploading}
                  className="p-2 rounded-lg text-charcoal-400 hover:text-charcoal-600 hover:bg-sand-100 transition-colors disabled:opacity-40"
                  title="Upload PDF"
                >
                  {isUploading ? (
                    <div className="w-5 h-5 border-2 border-charcoal-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Paperclip className="h-5 w-5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPasteArea(!showPasteArea)}
                  disabled={isLoading}
                  className={cn(
                    "p-2 rounded-lg transition-colors disabled:opacity-40",
                    showPasteArea
                      ? "text-terra-600 bg-terra-50"
                      : "text-charcoal-400 hover:text-charcoal-600 hover:bg-sand-100"
                  )}
                  title="Paste email/text"
                >
                  <FileText className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 relative">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const currentValue = (e.target as HTMLInputElement).value.trim();
                      if (currentValue && !isLoading) {
                        const form = e.currentTarget.closest('form');
                        if (form) {
                          form.requestSubmit();
                        }
                      }
                    }
                  }}
                  placeholder={
                    attachment
                      ? "Ask about this document..."
                      : "Ask about landlord-tenant law or HDPM procedures..."
                  }
                  disabled={isLoading}
                  className="w-full h-11 text-sm pl-4 pr-12 rounded-xl border border-sand-300 bg-sand-50 focus:outline-none focus:ring-2 focus:ring-terra-500/30 focus:border-terra-400 focus:bg-white transition-all placeholder:text-charcoal-300 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-charcoal-900 text-white hover:bg-charcoal-800 disabled:opacity-30 disabled:hover:bg-charcoal-900 transition-all"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Citations Sidebar (full mode only — the canvas replaces it in panel mode) */}
      {!isPanel && (
        <CitationsSidebar
          sources={currentSources}
          highlightedCitation={highlightedCitation}
          onCitationClick={handleCitationClick}
        />
      )}
    </div>
  );
}

/**
 * Compact source pills under an assistant answer (panel mode): one pill per
 * unique cited source (click → view it in the canvas), plus "Open <app> →"
 * chips when a cited SOP documents an app view.
 */
function SourcePillsRow({
  sources,
  onOpenSource,
  onOpenApp,
}: {
  sources: Source[];
  onOpenSource?: (source: Source) => void;
  onOpenApp?: (appKey: AppEmbedKey) => void;
}) {
  const unique: Source[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (!seen.has(s.url)) {
      seen.add(s.url);
      unique.push(s);
    }
  }

  const appKeys: AppEmbedKey[] = [];
  for (const s of unique) {
    const key = s.type === "notion_sop" ? sopUrlToAppKey(s.url) : null;
    if (key && !appKeys.includes(key)) appKeys.push(key);
  }

  return (
    <div className="px-6 pb-4 -mt-1 flex flex-wrap gap-1.5">
      {unique.map((s) => (
        <button
          key={s.url}
          onClick={() => onOpenSource?.(s)}
          className="inline-flex max-w-[240px] items-center gap-1 rounded-full border border-sand-200 bg-sand-50 px-2.5 py-1 text-2xs text-charcoal-600 transition-colors hover:border-terra-300 hover:bg-white hover:text-charcoal-900"
          title={`View "${s.title}" in the canvas`}
        >
          <span className="shrink-0">{s.icon}</span>
          <span className="truncate">{s.title}</span>
        </button>
      ))}
      {appKeys.map((key) => (
        <button
          key={key}
          onClick={() => onOpenApp?.(key)}
          className="inline-flex items-center gap-1 rounded-full bg-charcoal-900 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-charcoal-800"
        >
          Open {APP_EMBEDS[key].title} →
        </button>
      ))}
    </div>
  );
}

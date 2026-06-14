"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useState, useRef, useEffect, useMemo } from "react";
import { MessageText } from "./MessageText";
import type { ChatWidgetConfig } from "./types";

const STORAGE_KEY = "nettsmed-chat-messages-v1";
const SESSION_ID_KEY = "nettsmed-chat-session-id";

function genSessionId(): string {
  return "s-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
}

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = sessionStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const fresh = genSessionId();
    sessionStorage.setItem(SESSION_ID_KEY, fresh);
    return fresh;
  } catch {
    return genSessionId();
  }
}

function postToParent(message: Record<string, unknown>) {
  try {
    window.parent.postMessage(message, "*");
  } catch {
    // noop
  }
}

export function ChatWidget({
  embed = false,
  config,
}: {
  embed?: boolean;
  config: ChatWidgetConfig;
}) {
  const [isOpen, setIsOpen] = useState(embed);
  const [input, setInput] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sessionId = useMemo(() => getOrCreateSessionId(), []);
  const leadPartType = `tool-${config.leadToolName}`;

  const { messages, sendMessage, status, setMessages, regenerate } = useChat({
    transport: new DefaultChatTransport({
      api: config.apiPath ?? "/api/chat",
      body: () => {
        const p =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search)
            : new URLSearchParams();
        return {
          referer: p.get("ctx") || (typeof window !== "undefined" ? document.referrer : "") || "",
          pageUrl: p.get("ctx") || "",
          pageTitle: p.get("t") || "",
          sessionId,
        };
      },
    }),
    onError: (error) => {
      console.error("[chat] error:", error);
      setErrorMsg(config.errorMessage);
      postToParent({ type: "nettsmed-chat-event", event: "chatbot_error" });
    },
    onFinish: ({ message }) => {
      setErrorMsg(null);
      const leadPart = message.parts?.find((p) => p.type === leadPartType) as
        | { type: string; state: string; output?: { ok: boolean } }
        | undefined;
      if (leadPart?.state === "output-available" && leadPart.output?.ok) {
        postToParent({ type: "nettsmed-chat-event", event: config.leadEventName });
      }
    },
  });

  // Rehydrate messages from sessionStorage on mount (survives parent navigation).
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as UIMessage[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch {
      // noop
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist messages whenever they change.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (messages.length > 0) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
      }
    } catch {
      // noop
    }
  }, [messages, hydrated]);

  // Listen for focus-input postMessage from parent (widget.js).
  useEffect(() => {
    function handler(ev: MessageEvent) {
      if (ev?.data?.type === "focus-input") {
        setTimeout(() => inputRef.current?.focus(), 40);
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, status]);

  const isStreaming = status === "streaming" || status === "submitted";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    setErrorMsg(null);
    sendMessage({ text: input });
    postToParent({ type: "nettsmed-chat-event", event: "chatbot_message" });
    setInput("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleClose = () => {
    if (embed) {
      postToParent({ type: "nettsmed-chat-close" });
    } else {
      setIsOpen(false);
    }
  };

  const handleRetry = () => {
    setErrorMsg(null);
    regenerate();
  };

  // Auto-resize textarea based on content
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.max(24, Math.min(el.scrollHeight, 120));
    el.style.height = next + "px";
  }, [input]);

  // Auto-focus input when chat opens + emit "opened" analytics
  useEffect(() => {
    if (isOpen || embed) {
      const t = setTimeout(() => inputRef.current?.focus(), 250);
      postToParent({ type: "nettsmed-chat-event", event: "chatbot_opened" });
      return () => clearTimeout(t);
    }
  }, [isOpen, embed]);

  // Keep the cursor in the input after each response so you can just keep typing.
  useEffect(() => {
    if (!isStreaming && (isOpen || embed)) inputRef.current?.focus();
  }, [isStreaming, isOpen, embed]);

  const quickPrompts = config.quickPrompts;

  const handleQuickPrompt = (text: string) => {
    if (isStreaming) return;
    setErrorMsg(null);
    sendMessage({ text });
    postToParent({ type: "nettsmed-chat-event", event: "chatbot_message" });
  };

  const c = config.colors;
  const rootStyle = {
    "--cw-primary": c.primary,
    "--cw-primary-hover": c.primaryHover,
    "--cw-accent": c.accent,
    "--cw-header-from": c.headerGradientFrom,
    "--cw-header-to": c.headerGradientTo,
    "--cw-msg-bg": c.messageBg,
    "--cw-border": c.border,
    "--cw-qp-border": c.quickPromptBorder,
    "--cw-disabled-send": c.disabledSendBg,
    "--cw-muted": c.mutedLabel,
    "--cw-placeholder": c.placeholder,
    "--cw-footer": c.footerText,
    "--cw-error-bg": c.errorBg,
    "--cw-error-border": c.errorBorder,
    "--cw-error-text": c.errorText,
  } as React.CSSProperties;

  return (
    <div
      style={rootStyle}
      className={
        embed
          ? "nettsmed-chat-root w-screen h-screen font-sans"
          : "nettsmed-chat-root fixed bottom-5 right-5 z-[999999] font-sans"
      }
    >
      {!isOpen && !embed && (
        <button
          onClick={() => setIsOpen(true)}
          className="group flex items-center gap-2.5 bg-[var(--cw-primary)] text-white pl-4 pr-5 py-3 rounded-full shadow-[0_10px_30px_-8px_rgba(31,49,51,0.45)] hover:shadow-[0_14px_36px_-8px_rgba(31,49,51,0.55)] hover:bg-[var(--cw-primary-hover)] transition-all duration-300 cursor-pointer"
          aria-label={config.openAriaLabel}
        >
          <span className="relative flex items-center justify-center w-7 h-7 bg-white/10 rounded-full">
            <span className="absolute inset-0 rounded-full bg-[var(--cw-accent)] opacity-20 animate-ping"></span>
            <span className="relative text-[13px] font-semibold tracking-[0.02em]">{config.avatarLetter}</span>
          </span>
          <span className="font-medium text-[14px] tracking-[0.01em]">{config.launcherLabel}</span>
        </button>
      )}

      {(isOpen || embed) && (
        <div
          className={
            embed
              ? "w-full h-screen bg-white flex flex-col"
              : "w-[380px] h-[580px] max-h-[calc(100vh-40px)] bg-white rounded-[14px] shadow-[0_20px_60px_-15px_rgba(31,49,51,0.35)] flex flex-col overflow-hidden animate-[chatIn_0.28s_cubic-bezier(0.22,1,0.36,1)]"
          }
          style={{ border: embed ? undefined : "1px solid rgba(31,49,51,0.08)" }}
        >
          <header className="bg-gradient-to-b from-[var(--cw-header-from)] to-[var(--cw-header-to)] text-white px-4 pt-5 pb-4 flex items-center gap-3 shrink-0">
            <div className="relative flex items-center justify-center w-10 h-10 bg-[var(--cw-primary-hover)] rounded-full font-semibold text-[15px] tracking-[0.02em] shrink-0">
              {config.avatarLetter}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[var(--cw-accent)] rounded-full ring-2 ring-[var(--cw-header-from)]"></span>
            </div>
            <div className="flex-1 min-w-0 leading-tight">
              <div className="font-semibold text-[15px] tracking-[-0.01em] truncate">{config.assistantName}</div>
              <div className="text-[11px] text-white/70 tracking-[0.02em] truncate">
                {config.tagline}
              </div>
            </div>
            <button
              onClick={handleClose}
              className="shrink-0 text-white/75 hover:text-white w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/15 transition-colors cursor-pointer -mr-1"
              aria-label={config.closeAriaLabel}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M4 4 L14 14 M14 4 L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-scroll px-4 py-5 space-y-3.5 bg-[var(--cw-msg-bg)]"
            style={{ scrollbarGutter: "stable" }}
          >
            {messages.length === 0 && (
              <>
                <div className="flex gap-2.5 animate-[messageIn_0.35s_ease-out]">
                  <div className="flex-shrink-0 w-8 h-8 bg-[var(--cw-primary-hover)] text-white rounded-full flex items-center justify-center text-[12px] font-semibold mt-0.5">
                    {config.avatarLetter}
                  </div>
                  <div className="flex-1 bg-white rounded-[10px] rounded-tl-[4px] px-3.5 py-3 text-[13.5px] leading-[1.55] text-[var(--cw-primary)] border border-[var(--cw-border)]/60">
                    <p className="m-0">{config.greeting}</p>
                  </div>
                </div>

                <div className="pl-[42px] pt-1 animate-[messageIn_0.45s_ease-out]">
                  <div className="text-[11px] text-[var(--cw-muted)] mb-2 tracking-[0.02em] uppercase font-medium">
                    {config.quickPromptsHeading}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {quickPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => handleQuickPrompt(prompt)}
                        disabled={isStreaming}
                        className="text-left text-[12.5px] text-[var(--cw-primary-hover)] bg-white hover:bg-[var(--cw-primary-hover)] hover:text-white border border-[var(--cw-qp-border)] rounded-full px-3 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer w-fit max-w-full"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex gap-2.5 animate-[messageIn_0.3s_ease-out] ${
                  m.role === "user" ? "flex-row-reverse" : ""
                }`}
              >
                {m.role === "assistant" && (
                  <div className="flex-shrink-0 w-8 h-8 bg-[var(--cw-primary-hover)] text-white rounded-full flex items-center justify-center text-[12px] font-semibold mt-0.5">
                    {config.avatarLetter}
                  </div>
                )}
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[78%] bg-[var(--cw-primary)] text-white rounded-[10px] rounded-tr-[4px] px-3.5 py-2.5 text-[13.5px] leading-[1.5]"
                      : "max-w-[82%] bg-white text-[var(--cw-primary)] rounded-[10px] rounded-tl-[4px] px-3.5 py-3 text-[13.5px] border border-[var(--cw-border)]/60"
                  }
                >
                  {m.parts?.map((part, i) => {
                    if (part.type === "text") {
                      return (
                        <MessageText
                          key={i}
                          text={part.text}
                          tone={m.role === "user" ? "user" : "bot"}
                          linkTarget={config.linkTarget}
                        />
                      );
                    }
                    if (part.type === leadPartType) {
                      const lp = part as unknown as {
                        state: string;
                        output?: { ok: boolean; message: string };
                      };
                      if (lp.state === "output-available") {
                        const output = lp.output as { ok: boolean; message: string };
                        return (
                          <div
                            key={i}
                            className="mt-2 pt-2 border-t border-current/10 text-[12px] opacity-70 flex items-start gap-1.5"
                          >
                            <span className="text-[var(--cw-accent)] shrink-0 mt-0.5">✓</span>
                            <span>{output.message}</span>
                          </div>
                        );
                      }
                      if (lp.state === "input-streaming" || lp.state === "input-available") {
                        return (
                          <div key={i} className="mt-2 text-[12px] opacity-60 italic">
                            {config.leadSavingLabel}
                          </div>
                        );
                      }
                      return null;
                    }
                    return null;
                  })}
                </div>
              </div>
            ))}

            {isStreaming &&
              messages[messages.length - 1]?.role === "user" && (
                <div className="flex gap-2.5 animate-[messageIn_0.3s_ease-out]">
                  <div className="flex-shrink-0 w-8 h-8 bg-[var(--cw-primary-hover)] text-white rounded-full flex items-center justify-center text-[12px] font-semibold mt-0.5">
                    {config.avatarLetter}
                  </div>
                  <div className="bg-white rounded-[10px] rounded-tl-[4px] px-3.5 py-3.5 border border-[var(--cw-border)]/60">
                    <span className="flex gap-1.5 items-center">
                      <span className="w-1.5 h-1.5 bg-[var(--cw-primary-hover)] rounded-full animate-[dot_1.2s_ease-in-out_infinite]"></span>
                      <span className="w-1.5 h-1.5 bg-[var(--cw-primary-hover)] rounded-full animate-[dot_1.2s_ease-in-out_infinite] [animation-delay:0.15s]"></span>
                      <span className="w-1.5 h-1.5 bg-[var(--cw-primary-hover)] rounded-full animate-[dot_1.2s_ease-in-out_infinite] [animation-delay:0.3s]"></span>
                    </span>
                  </div>
                </div>
              )}

            {errorMsg && !isStreaming && (
              <div className="flex items-start gap-2 bg-[var(--cw-error-bg)] border border-[var(--cw-error-border)] rounded-[8px] px-3 py-2.5 text-[12.5px] text-[var(--cw-error-text)]">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 mt-0.5" aria-hidden="true">
                  <circle cx="8" cy="8" r="6.5" />
                  <path d="M8 5 L8 8.5 M8 11 L8 11.01" strokeLinecap="round" />
                </svg>
                <div className="flex-1">
                  <p className="m-0">{errorMsg}</p>
                  {messages[messages.length - 1]?.role === "user" && (
                    <button
                      onClick={handleRetry}
                      className="mt-1.5 underline underline-offset-2 font-medium hover:opacity-80 cursor-pointer"
                    >
                      {config.retryLabel}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="border-t border-[var(--cw-border)] px-3 py-3 bg-white shrink-0"
          >
            <div className="flex items-center gap-2 bg-[var(--cw-msg-bg)] rounded-[8px] border border-transparent focus-within:border-[var(--cw-primary-hover)]/40 focus-within:bg-white transition-colors pl-3 pr-1.5 py-1.5">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={config.inputPlaceholder}
                rows={1}
                className="flex-1 bg-transparent text-[13.5px] leading-[1.5] text-[var(--cw-primary)] placeholder-[var(--cw-placeholder)] focus:outline-none resize-none max-h-[120px] py-1 disabled:opacity-50 block"
                style={{ minHeight: "24px" }}
              />
              <button
                type="submit"
                disabled={isStreaming || !input.trim()}
                className="flex items-center justify-center w-8 h-8 bg-[var(--cw-primary)] hover:bg-[var(--cw-primary-hover)] disabled:bg-[var(--cw-disabled-send)] disabled:cursor-not-allowed text-white rounded-[6px] transition-colors shrink-0 cursor-pointer self-end"
                aria-label={config.sendAriaLabel}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 13 L8 3 M4 7 L8 3 L12 7" />
                </svg>
              </button>
            </div>
            <div className="text-[10.5px] text-[var(--cw-footer)] text-center pt-2 tracking-[0.02em]">
              {config.footer}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

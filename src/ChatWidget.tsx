"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { MessageText } from "./MessageText";
import {
  PROGRAMMATIC_PIN_MIN_FRAMES,
  beginProgrammaticPin,
  createStickRuntime,
  distanceFromBottom,
  endProgrammaticPin,
  notePointerDelta,
  notePointerDown,
  notePointerUp,
  noteWheel,
  onTranscriptScroll,
  programmaticPinStep,
  scrollBehaviorFor,
  settleUserGesture,
  shouldFollowContent,
  shouldShowJumpToLatest,
  stickForSendOrJump,
  type ScrollBox,
  type StickRuntime,
} from "./scrollStickiness";
import {
  isSilentAssistantPlaceholder,
  readJevRouteDataPart,
  transcriptWait,
  waitingRowVisible,
  type JevRoute,
  type WaitingMessage,
} from "./jevRoute";
import { createBridgeClient } from "./siteBridgeClient";
import { LeadCaptureForm } from "./LeadCaptureForm";
import {
  DEFAULT_LEAD_FORM_COPY,
  buildLeadSubmission,
  commentRequiredFor,
  fallbackLeadSummary,
  findCollectedEmail,
  hasOpenLeadForm,
  isValidEmail,
  leadToolView,
  leadFormSuperseded,
  messagesWithLeadSubmission,
  readLeadComment,
  readLeadEmail,
  shouldContinueExistingApproval,
  shouldShowStandaloneLeadForm,
  type LeadFormCopy,
  type LeadScanMessage,
  type LeadToolSnapshot,
} from "./leadForm";
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
  /** Jev route for the in-flight turn. Null until the response says so — never guessed. */
  const [jevRoute, setJevRoute] = useState<JevRoute | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Follow the latest token. False after the user scrolls up past the threshold. */
  const stickRef = useRef<StickRuntime>(createStickRuntime());
  /** Last scroll box we observed, so a leaked programmatic event can be told from a scroll-up. */
  const lastScrollBoxRef = useRef<ScrollBox | null>(null);
  /** Bumps so a late scrollend from an older jump cannot unlock a newer one. */
  const smoothGenRef = useRef(0);
  const scrollUnlockTimer = useRef<number | null>(null);
  /** True only while a smooth «Hopp til siste» animation is in flight. */
  const smoothLockRef = useRef(false);
  const activePointerRef = useRef<{ id: number; y: number } | null>(null);
  const gestureTokenRef = useRef(0);
  const gestureTimerRef = useRef<number | null>(null);
  const gestureEndRef = useRef<(() => void) | null>(null);
  const detachPinScrollEndRef = useRef<(() => void) | null>(null);
  const panelOpenRef = useRef(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const sessionId = useMemo(() => getOrCreateSessionId(), []);
  const leadPartType = `tool-${config.leadToolName}`;
  const leadCopy: LeadFormCopy = { ...DEFAULT_LEAD_FORM_COPY, ...config.leadForm };
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  const queryEmail = useMemo(() => {
    if (typeof window === "undefined") return "";
    try {
      return new URLSearchParams(window.location.search).get("email") ?? "";
    } catch {
      return "";
    }
  }, []);

  // Parent page host + origin (from ?ctx). Host drives same-site link follow;
  // origin scopes the site-bridge postMessage target.
  const { parentHost, parentOrigin } = useMemo(() => {
    if (typeof window === "undefined") return { parentHost: "", parentOrigin: "" };
    try {
      const ctx =
        new URLSearchParams(window.location.search).get("ctx") || document.referrer || "";
      if (!ctx) return { parentHost: "", parentOrigin: "" };
      const u = new URL(ctx);
      return { parentHost: u.host, parentOrigin: u.origin };
    } catch {
      return { parentHost: "", parentOrigin: "" };
    }
  }, []);

  // Site-bridge client (iframe side) — only when embedded with a known parent
  // origin and the tenant enabled a prefill tool.
  const bridge = useMemo(
    () => (parentOrigin && config.prefillToolName ? createBridgeClient(parentOrigin) : null),
    [parentOrigin, config.prefillToolName],
  );
  useEffect(() => () => bridge?.dispose(), [bridge]);
  const firedPrefill = useRef<Set<string>>(new Set());
  const [prefillStatus, setPrefillStatus] = useState<Record<string, "pending" | "ok" | "fail">>({});

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
    // Response headers never reach useChat. The site prepends a transient
    // `data-jev-route` part on every 200 stream; onData is where it arrives.
    onData: (part) => {
      const route = readJevRouteDataPart(part);
      if (route) setJevRoute(route);
    },
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

  const scrollBox = (el: HTMLElement): ScrollBox => ({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  });

  const syncJumpChip = (box: ScrollBox) => {
    const show = shouldShowJumpToLatest(box);
    setShowJumpToLatest((prev) => (prev === show ? prev : show));
  };

  const clearPinTimer = () => {
    if (scrollUnlockTimer.current != null) {
      clearTimeout(scrollUnlockTimer.current);
      scrollUnlockTimer.current = null;
    }
  };

  const pinToBottom = (el: HTMLElement, intent: "follow" | "jump") => {
    const behavior = scrollBehaviorFor(
      intent,
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    );
    const gen = ++smoothGenRef.current;
    clearPinTimer();
    detachPinScrollEndRef.current?.();
    detachPinScrollEndRef.current = null;
    stickRef.current = beginProgrammaticPin(stickRef.current);
    if (behavior === "auto") {
      // Instant. `behavior: "smooth"` on every token fights itself mid-stream.
      // Keep the ignore window open across the async `scroll` event: WebKit
      // and mobile Chromium can dispatch it after this function returns, while
      // scrollHeight has already grown. Releasing early flips stickToBottom off
      // for the rest of the stream.
      smoothLockRef.current = false;
      el.scrollTop = el.scrollHeight;
      lastScrollBoxRef.current = scrollBox(el);
      let frames = 0;
      let repins = 0;
      let detachScrollEnd = () => {};
      const release = () => {
        detachScrollEnd();
        detachScrollEnd = () => {};
        if (smoothGenRef.current !== gen) return;
        smoothGenRef.current += 1;
        stickRef.current = endProgrammaticPin(stickRef.current);
        clearPinTimer();
        lastScrollBoxRef.current = scrollBox(el);
      };
      const tick = () => {
        if (smoothGenRef.current !== gen) return;
        if (stickRef.current.userScrollIntent) {
          release();
          return;
        }
        frames += 1;
        const action = programmaticPinStep(distanceFromBottom(scrollBox(el)), frames);
        if (action === "hold") {
          requestAnimationFrame(tick);
          return;
        }
        if (action === "repin" && repins < 3) {
          repins += 1;
          frames = 0;
          el.scrollTop = el.scrollHeight;
          lastScrollBoxRef.current = scrollBox(el);
          requestAnimationFrame(tick);
          return;
        }
        release();
      };
      const onScrollEnd = () => {
        if (smoothGenRef.current !== gen) return;
        // A scrollend in the same turn as `scrollTop =` must not close the
        // window; the async scroll listener still has to run under ignore.
        if (frames < PROGRAMMATIC_PIN_MIN_FRAMES) return;
        tick();
      };
      detachScrollEnd = () => {
        el.removeEventListener("scrollend", onScrollEnd);
        if (detachPinScrollEndRef.current === detachScrollEnd) detachPinScrollEndRef.current = null;
      };
      detachPinScrollEndRef.current = detachScrollEnd;
      el.addEventListener("scrollend", onScrollEnd);
      requestAnimationFrame(tick);
      // Cap so a throttled rAF cannot leave user scrolls ignored.
      scrollUnlockTimer.current = window.setTimeout(() => {
        if (smoothGenRef.current !== gen) return;
        if (!stickRef.current.userScrollIntent && distanceFromBottom(scrollBox(el)) > 1 && repins < 3) {
          repins += 1;
          el.scrollTop = el.scrollHeight;
          lastScrollBoxRef.current = scrollBox(el);
        }
        release();
      }, 200);
      return;
    }
    smoothLockRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior });
    lastScrollBoxRef.current = scrollBox(el);
    const unlock = () => {
      detachPinScrollEndRef.current?.();
      detachPinScrollEndRef.current = null;
      if (smoothGenRef.current !== gen) return;
      stickRef.current = endProgrammaticPin(stickRef.current);
      smoothLockRef.current = false;
      clearPinTimer();
      lastScrollBoxRef.current = scrollBox(el);
    };
    detachPinScrollEndRef.current = () => {
      el.removeEventListener("scrollend", unlock);
      detachPinScrollEndRef.current = null;
    };
    el.addEventListener("scrollend", unlock, { once: true });
    scrollUnlockTimer.current = window.setTimeout(unlock, 1000);
  };

  const cancelSmoothScroll = (el: HTMLElement) => {
    if (!smoothLockRef.current) return;
    smoothGenRef.current += 1;
    smoothLockRef.current = false;
    stickRef.current = endProgrammaticPin(stickRef.current);
    clearPinTimer();
    detachPinScrollEndRef.current?.();
    detachPinScrollEndRef.current = null;
    // Re-assigning scrollTop aborts an in-flight smooth scrollTo.
    const top = el.scrollTop;
    el.scrollTop = top;
    lastScrollBoxRef.current = scrollBox(el);
  };

  const followIfStuck = (el: HTMLElement) => {
    if (!shouldFollowContent(stickRef.current)) {
      syncJumpChip(scrollBox(el));
      return;
    }
    pinToBottom(el, "follow");
    syncJumpChip(scrollBox(el));
  };

  const resumeStickiness = () => {
    smoothGenRef.current += 1;
    stickRef.current = stickForSendOrJump(stickRef.current);
    setShowJumpToLatest(false);
  };

  const armGestureSettle = (el: HTMLElement) => {
    if (gestureTimerRef.current != null) {
      clearTimeout(gestureTimerRef.current);
      gestureTimerRef.current = null;
    }
    if (gestureEndRef.current) {
      el.removeEventListener("scrollend", gestureEndRef.current);
      gestureEndRef.current = null;
    }
    const token = ++gestureTokenRef.current;
    const finish = () => {
      if (gestureTokenRef.current !== token) return;
      gestureTokenRef.current += 1;
      if (gestureEndRef.current) {
        el.removeEventListener("scrollend", gestureEndRef.current);
        gestureEndRef.current = null;
      }
      if (gestureTimerRef.current != null) {
        clearTimeout(gestureTimerRef.current);
        gestureTimerRef.current = null;
      }
      stickRef.current = settleUserGesture(stickRef.current);
      if (shouldFollowContent(stickRef.current)) pinToBottom(el, "follow");
      syncJumpChip(scrollBox(el));
    };
    const onEnd = () => finish();
    gestureEndRef.current = onEnd;
    el.addEventListener("scrollend", onEnd);
    // scrollend is the fast path; the timer covers a lost pointerup and
    // browsers that never fire scrollend. Reset on every user scroll event.
    gestureTimerRef.current = window.setTimeout(finish, 500);
  };

  const markUserScroll = (el: HTMLElement, next: StickRuntime) => {
    const started = next.userScrollIntent && !stickRef.current.userScrollIntent;
    stickRef.current = next;
    if (!next.userScrollIntent) return;
    if (started) {
      smoothGenRef.current += 1;
      stickRef.current = endProgrammaticPin(stickRef.current);
      cancelSmoothScroll(el);
    }
    armGestureSettle(el);
  };

  const wait = transcriptWait({
    status,
    messages: messages as WaitingMessage[],
    signaledRoute: jevRoute,
    parentHost,
    searchingLabel: config.searchingLabel,
  });
  const showWaitingRow = waitingRowVisible(messages as WaitingMessage[], wait);
  const hideTrailingPlaceholder =
    showWaitingRow && isSilentAssistantPlaceholder(messages[messages.length - 1] as WaitingMessage | undefined);
  const renderedMessages = hideTrailingPlaceholder ? messages.slice(0, -1) : messages;
  const waitingFollowKey = showWaitingRow ? (wait.show && wait.kind === "searching" ? wait.label : "dots") : "";

  // Stick while near the bottom; pause when the user scrolls up. Same container
  // in the embed/mobile sheet and the desktop panel (`scrollRef` — flex
  // min-h-0 overflow-y-scroll inside the h-screen embed column).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      const box = scrollBox(el);
      const next = onTranscriptScroll(stickRef.current, box, lastScrollBoxRef.current);
      lastScrollBoxRef.current = box;
      markUserScroll(el, next);
      if (next.userScrollIntent || !next.ignoreProgrammaticScroll) syncJumpChip(box);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      activePointerRef.current = { id: e.pointerId, y: e.clientY };
      stickRef.current = notePointerDown(stickRef.current);
    };

    const onPointerMove = (e: PointerEvent) => {
      const active = activePointerRef.current;
      if (!active || e.pointerId !== active.id) return;
      markUserScroll(el, notePointerDelta(stickRef.current, e.clientY - active.y));
    };

    const onPointerUp = (e: PointerEvent) => {
      const active = activePointerRef.current;
      if (active && e.pointerId !== active.id) return;
      activePointerRef.current = null;
      stickRef.current = notePointerUp(stickRef.current);
    };

    const onWheel = (e: WheelEvent) => {
      markUserScroll(el, noteWheel(stickRef.current, e.deltaY));
    };

    // Touch path as well as pointer: iOS can take over scrolling after the
    // first touchmove and not deliver pointermove for the rest of the drag.
    let touchStartY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? null;
      stickRef.current = notePointerDown(stickRef.current);
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (y == null || touchStartY == null) return;
      markUserScroll(el, notePointerDelta(stickRef.current, y - touchStartY));
    };
    const onTouchEnd = () => {
      touchStartY = null;
      stickRef.current = notePointerUp(stickRef.current);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      clearPinTimer();
      detachPinScrollEndRef.current?.();
      detachPinScrollEndRef.current = null;
      if (gestureTimerRef.current != null) {
        clearTimeout(gestureTimerRef.current);
        gestureTimerRef.current = null;
      }
      if (gestureEndRef.current) {
        el.removeEventListener("scrollend", gestureEndRef.current);
        gestureEndRef.current = null;
      }
    };
    // Rebind when the panel mounts the transcript.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, embed]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const open = isOpen || embed;
    if (open && !panelOpenRef.current) {
      stickRef.current = createStickRuntime();
      lastScrollBoxRef.current = null;
    }
    panelOpenRef.current = open;
    if (!el) return;
    followIfStuck(el);
    // `waitingFollowKey` is the «Søker …» / dots row. Same stickiness rules as
    // message growth: follow only while stuck, never a new scroll container.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, status, isOpen, embed, waitingFollowKey]);

  // Token growth can mutate message parts in place (no new `messages`
  // identity) and images/markdown can reflow after commit. The content box
  // and the scrollport itself (mobile keyboard) both re-trigger follow.
  useEffect(() => {
    const content = contentRef.current;
    const el = scrollRef.current;
    if (!content || !el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => followIfStuck(el));
    observer.observe(content);
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, embed]);

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    smoothGenRef.current += 1;
    stickRef.current = stickForSendOrJump(stickRef.current);
    setShowJumpToLatest(false);
    pinToBottom(el, "jump");
  };

  // When the prefill tool returns {action:"prefill", form, fields}, ask the
  // parent (via the site-bridge) to fill its form. Fire once per message.
  useEffect(() => {
    if (!bridge || !config.prefillToolName) return;
    const partType = `tool-${config.prefillToolName}`;
    for (const m of messages) {
      if (m.role !== "assistant" || firedPrefill.current.has(m.id)) continue;
      for (const part of m.parts ?? []) {
        const p = part as {
          type?: string;
          state?: string;
          output?: { action?: string; form?: string; fields?: Record<string, unknown> };
        };
        if (p.type !== partType || p.state !== "output-available") continue;
        if (p.output?.action === "prefill" && p.output.form) {
          const mid = m.id;
          firedPrefill.current.add(mid);
          setPrefillStatus((s) => ({ ...s, [mid]: "pending" }));
          bridge
            .request("prefill", { form: p.output.form, fields: p.output.fields ?? {} })
            .then((r) => setPrefillStatus((s) => ({ ...s, [mid]: r.ok ? "ok" : "fail" })))
            .catch(() => setPrefillStatus((s) => ({ ...s, [mid]: "fail" })));
        }
      }
    }
  }, [messages, bridge, config.prefillToolName]);

  const isStreaming = status === "streaming" || status === "submitted";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    setErrorMsg(null);
    setJevRoute(null);
    resumeStickiness();
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
    setJevRoute(null);
    resumeStickiness();
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
  // Don't steal focus from the lead form — that is the next thing to fill in.
  useEffect(() => {
    if (!isStreaming && (isOpen || embed) && !hasOpenLeadForm(messages as LeadScanMessage[], leadPartType)) {
      inputRef.current?.focus();
    }
  }, [isStreaming, isOpen, embed]);

  const quickPrompts = config.quickPrompts;

  const handleQuickPrompt = (text: string) => {
    if (isStreaming) return;
    setErrorMsg(null);
    setJevRoute(null);
    resumeStickiness();
    sendMessage({ text });
    postToParent({ type: "nettsmed-chat-event", event: "chatbot_message" });
  };

  const scanMessages = messages as LeadScanMessage[];
  const collectedEmail = findCollectedEmail(scanMessages, queryEmail);
  const showStandaloneLeadForm = shouldShowStandaloneLeadForm(scanMessages, leadPartType);

  const leadLock = useRef(false);

  const submitLead = (draft: { email: string; comment: string }, target?: {
    messageId: string;
    part: LeadToolSnapshot;
    explicitSend: boolean;
  }) => {
    if (leadLock.current || isStreaming) return;
    leadLock.current = true;
    const explicitSend = target ? target.explicitSend : true;
    const existing = target?.part.input;
    const built = buildLeadSubmission(existing, {
      email: draft.email || collectedEmail,
      comment: draft.comment,
    }, {
      explicitSend,
      summaryFallback: fallbackLeadSummary(scanMessages),
    });
    if (!built.ok) {
      setLeadError(built.field === "comment" ? leadCopy.commentMissing : leadCopy.emailInvalid);
      return;
    }
    setLeadError(null);
    const last = messages[messages.length - 1];
    const continueApproval =
      target != null &&
      shouldContinueExistingApproval(target.part, last?.id === target.messageId) &&
      typeof target.part.toolCallId === "string";
    const stamp = Date.now().toString(36);
    const next = messagesWithLeadSubmission(
      messages as unknown as Parameters<typeof messagesWithLeadSubmission>[0],
      leadPartType,
      built.input,
      continueApproval
        ? {
            messageId: target.messageId,
            toolCallId: target.part.toolCallId as string,
            approvalId: target.part.approval?.id as string,
          }
        : null,
      { messageId: `lead-${stamp}`, toolCallId: `call-${stamp}`, approvalId: `appr-${stamp}` },
    );
    setLeadBusy(true);
    setJevRoute(null);
    resumeStickiness();
    setMessages(next as typeof messages);
    // Last message is the assistant tool call. sendMessage() with no new user
    // turn posts that history; streamText executes the approved capture_lead.
    void sendMessage()
      .catch(() => setLeadError(config.errorMessage))
      .finally(() => {
        leadLock.current = false;
        setLeadBusy(false);
      });
  };

  const renderLeadForm = (
    key: string,
    options: {
      initialEmail: string;
      initialComment: string;
      showEmail: boolean;
      commentRequired: boolean;
      flush?: boolean;
      onSubmit: (draft: { email: string; comment: string }) => void;
    },
  ) => (
    <LeadCaptureForm
      key={key}
      copy={leadCopy}
      initialEmail={options.initialEmail}
      initialComment={options.initialComment}
      showEmail={options.showEmail}
      commentRequired={options.commentRequired}
      busy={leadBusy || isStreaming}
      serverError={leadError}
      flush={options.flush}
      onSubmit={options.onSubmit}
    />
  );

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
          role="dialog"
          aria-modal={embed ? undefined : "true"}
          aria-label={`${config.assistantName} – ${config.tagline}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") handleClose();
          }}
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

          <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            role="log"
            aria-live="polite"
            aria-busy={isStreaming}
            aria-label={`Samtale med ${config.assistantName}`}
            className="min-h-0 flex-1 overflow-y-scroll px-4 py-5 bg-[var(--cw-msg-bg)]"
            style={{ scrollbarGutter: "stable" }}
          >
            <div ref={contentRef} className="space-y-3.5">
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

            {renderedMessages.map((m, messageIndex) => (
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
                      : `${
                          m.parts?.some(
                            (p) =>
                              p.type === leadPartType &&
                              leadToolView(p as unknown as LeadToolSnapshot) === "form",
                          )
                            ? "min-w-0 max-w-full flex-1"
                            : "max-w-[82%]"
                        } bg-white text-[var(--cw-primary)] rounded-[10px] rounded-tl-[4px] px-3.5 py-3 text-[13.5px] border border-[var(--cw-border)]/60`
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
                          parentHost={parentHost}
                        />
                      );
                    }
                    if (part.type === leadPartType) {
                      const lp = part as unknown as LeadToolSnapshot & {
                        output?: { ok: boolean; message: string };
                      };
                      const view = leadToolView(lp);
                      if (view === "success") {
                        return (
                          <div
                            key={i}
                            className="mt-2 pt-2 border-t border-current/10 text-[12px] opacity-70 flex items-start gap-1.5"
                          >
                            <span className="text-[var(--cw-accent)] shrink-0 mt-0.5">✓</span>
                            <span>{lp.output?.message}</span>
                          </div>
                        );
                      }
                      if (view === "form") {
                        if (leadFormSuperseded(renderedMessages as LeadScanMessage[], messageIndex, leadPartType)) {
                          return null;
                        }
                        const knownEmail = readLeadEmail(lp.input) || collectedEmail;
                        return renderLeadForm(lp.toolCallId || `${m.id}-${i}`, {
                          initialEmail: knownEmail,
                          initialComment: readLeadComment(lp.input),
                          showEmail: !isValidEmail(knownEmail),
                          commentRequired: commentRequiredFor(lp.input, false),
                          onSubmit: (draft) =>
                            submitLead(draft, {
                              messageId: m.id,
                              part: lp,
                              explicitSend: commentRequiredFor(lp.input, false),
                            }),
                        });
                      }
                      if (view === "failed") {
                        return (
                          <div
                            key={i}
                            className="mt-2 pt-2 border-t border-current/10 text-[12px] opacity-70 flex items-start gap-1.5"
                          >
                            <span className="shrink-0 mt-0.5">!</span>
                            <span>{lp.output?.message || config.errorMessage}</span>
                          </div>
                        );
                      }
                      if (lp.state === "input-streaming" || lp.state === "input-available" || lp.state === "approval-responded") {
                        return (
                          <div key={i} className="mt-2 text-[12px] opacity-60 italic">
                            {config.leadSavingLabel}
                          </div>
                        );
                      }
                      return null;
                    }
                    if (config.prefillToolName && part.type === `tool-${config.prefillToolName}`) {
                      const pp = part as unknown as {
                        state: string;
                        output?: { ok?: boolean; message?: string };
                      };
                      if (pp.state !== "output-available") return null;
                      const st = prefillStatus[m.id];
                      // Gate the confirmation on the ACTUAL bridge result — never
                      // claim "filled" if nothing was written. "pending" only
                      // while a fired request is in flight (8s timeout → fail);
                      // undefined (no bridge on this page) falls back, never hangs.
                      if (st === "pending") {
                        return (
                          <div key={i} className="mt-2 text-[12px] opacity-60 italic">
                            Fyller inn skjemaet…
                          </div>
                        );
                      }
                      if (st === "ok") {
                        return (
                          <div
                            key={i}
                            className="mt-2 pt-2 border-t border-current/10 text-[12px] opacity-70 flex items-start gap-1.5"
                          >
                            <span className="text-[var(--cw-accent)] shrink-0 mt-0.5">✓</span>
                            <span>{pp.output?.message}</span>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={i}
                          className="mt-2 pt-2 border-t border-current/10 text-[12px] opacity-70 flex items-start gap-1.5"
                        >
                          <span className="shrink-0 mt-0.5">⚠</span>
                          <span>
                            {config.prefillFailMessage ??
                              "Jeg fikk ikke fylt ut skjemaet automatisk her — bruk gjerne kontaktskjemaet direkte."}
                          </span>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            ))}

            {showStandaloneLeadForm && (
              <div className="flex gap-2.5 animate-[messageIn_0.3s_ease-out]">
                <div className="flex-shrink-0 w-8 h-8 bg-[var(--cw-primary-hover)] text-white rounded-full flex items-center justify-center text-[12px] font-semibold mt-0.5">
                  {config.avatarLetter}
                </div>
                <div className="min-w-0 flex-1 bg-white text-[var(--cw-primary)] rounded-[10px] rounded-tl-[4px] px-3.5 py-3 text-[13.5px] border border-[var(--cw-border)]/60">
                  {renderLeadForm("standalone-send", {
                    initialEmail: collectedEmail,
                    initialComment: "",
                    showEmail: !isValidEmail(collectedEmail),
                    commentRequired: true,
                    flush: true,
                    onSubmit: (draft) => submitLead(draft),
                  })}
                </div>
              </div>
            )}

            {showWaitingRow && (
                <div className="flex gap-2.5 animate-[messageIn_0.3s_ease-out]">
                  <div className="flex-shrink-0 w-8 h-8 bg-[var(--cw-primary-hover)] text-white rounded-full flex items-center justify-center text-[12px] font-semibold mt-0.5">
                    {config.avatarLetter}
                  </div>
                  <div className="bg-white rounded-[10px] rounded-tl-[4px] px-3.5 py-3.5 border border-[var(--cw-border)]/60">
                    {wait.show && wait.kind === "searching" ? (
                      <span role="status" className="text-[13px] leading-[1.45] text-[var(--cw-primary)]">
                        {wait.label}
                      </span>
                    ) : (
                      <>
                        <span className="cw-sr-only">{wait.show ? wait.srLabel : "Skriver svar…"}</span>
                        <span className="flex gap-1.5 items-center" aria-hidden="true">
                          <span className="w-1.5 h-1.5 bg-[var(--cw-primary-hover)] rounded-full animate-[dot_1.2s_ease-in-out_infinite]"></span>
                          <span className="w-1.5 h-1.5 bg-[var(--cw-primary-hover)] rounded-full animate-[dot_1.2s_ease-in-out_infinite] [animation-delay:0.15s]"></span>
                          <span className="w-1.5 h-1.5 bg-[var(--cw-primary-hover)] rounded-full animate-[dot_1.2s_ease-in-out_infinite] [animation-delay:0.3s]"></span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}

            {errorMsg && !isStreaming && (
              <div role="alert" className="flex items-start gap-2 bg-[var(--cw-error-bg)] border border-[var(--cw-error-border)] rounded-[8px] px-3 py-2.5 text-[12.5px] text-[var(--cw-error-text)]">
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
          </div>
          {showJumpToLatest && (
            <button
              type="button"
              onClick={jumpToLatest}
              className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full border border-[var(--cw-border)] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[var(--cw-primary)] shadow-[0_8px_20px_-8px_rgba(31,49,51,0.55)] hover:bg-[var(--cw-msg-bg)] cursor-pointer"
            >
              Hopp til siste
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2.5 4.5 L6 8 L9.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
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

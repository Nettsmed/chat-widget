/**
 * Visitor comment on the «Send samtalen til oss» lead path.
 *
 * The site tool `capture_lead` accepts `comment` / `visitor_message` and
 * refuses `explicit_send` without a comment. The widget must not rely on the
 * model asking for that comment in prose: either the tool pauses in
 * `approval-requested` (AI SDK human-in-the-loop) or the visitor submits this
 * form and we continue the chat with an approved tool part whose `input`
 * carries the comment. `streamText` executes that approved call.
 */

export const SEND_CONVERSATION_RE = /send(?:e|er|t)?(?:\s+\p{L}+){0,4}\s+samtalen/iu;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LeadFormCopy = {
  title: string;
  emailLabel: string;
  emailPlaceholder: string;
  commentLabel: string;
  commentPlaceholder: string;
  submitLabel: string;
  commentMissing: string;
  emailInvalid: string;
  hint: string;
};

export const DEFAULT_LEAD_FORM_COPY: LeadFormCopy = {
  title: "Send samtalen til oss",
  emailLabel: "E-post",
  emailPlaceholder: "deg@firma.no",
  commentLabel: "Kommentar",
  commentPlaceholder: "Hva vil du at vi skal følge opp?",
  submitLabel: "Send samtalen til oss",
  commentMissing: "Skriv en kort kommentar før du sender.",
  emailInvalid: "Skriv en gyldig e-postadresse.",
  hint: "Kommentaren din kommer øverst i henvendelsen.",
};

export type LeadToolView = "form" | "saving" | "success" | "failed";

export type LeadToolSnapshot = {
  state?: string;
  input?: unknown;
  output?: { ok?: boolean; message?: string } | null;
  approval?: { id?: string; approved?: boolean } | null;
  toolCallId?: string;
};

export type LeadDraft = { email: string; comment: string };

export type LeadSubmission =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; field: "email" | "comment" };

type TextPart = { type?: string; text?: string; input?: unknown; state?: string; output?: { ok?: boolean } | null; toolCallId?: string; approval?: { id?: string } | null };

export type LeadScanMessage = {
  id?: string;
  role: string;
  parts?: ReadonlyArray<TextPart>;
};

export function leadInputRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

export function isExplicitSend(input: unknown): boolean {
  const value = leadInputRecord(input).explicit_send;
  return value === true || value === "true";
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function readLeadEmail(input: unknown): string {
  const email = leadInputRecord(input).email;
  return typeof email === "string" ? email.trim() : "";
}

export function readLeadComment(input: unknown): string {
  const record = leadInputRecord(input);
  const raw = record.comment ?? record.visitor_message;
  return typeof raw === "string" ? raw.trim() : "";
}

export function isSendConversationText(text: string): boolean {
  return SEND_CONVERSATION_RE.test(text);
}

export function messageText(message: LeadScanMessage | undefined): string {
  if (!message?.parts) return "";
  return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

/** What to render for one `tool-${leadToolName}` part. */
export function leadToolView(part: LeadToolSnapshot): LeadToolView {
  switch (part.state) {
    case "approval-requested":
      return "form";
    case "input-streaming":
    case "input-available":
    case "approval-responded":
      return "saving";
    case "output-available":
      if (part.output?.ok) return "success";
      return isExplicitSend(part.input) ? "form" : "failed";
    case "output-error":
    case "output-denied":
      return isExplicitSend(part.input) ? "form" : "failed";
    default:
      return "saving";
  }
}

export function commentRequiredFor(input: unknown, standaloneSend: boolean): boolean {
  return standaloneSend || isExplicitSend(input);
}

/**
 * Continue an in-flight approval on the last assistant message.
 * A finished tool result (including an explicit-send refusal) must not be
 * patched — the server will not execute it again.
 */
export function shouldContinueExistingApproval(
  part: LeadToolSnapshot | undefined,
  messageIsLast: boolean,
): boolean {
  return Boolean(
    messageIsLast && part?.state === "approval-requested" && typeof part.approval?.id === "string" && part.approval.id,
  );
}

export function findCollectedEmail(messages: readonly LeadScanMessage[], queryEmail = ""): string {
  const fromQuery = queryEmail.trim();
  if (isValidEmail(fromQuery)) return fromQuery;

  const fromTools: string[] = [];
  const fromUsers: string[] = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const fromInput = readLeadEmail(part.input);
      if (isValidEmail(fromInput)) fromTools.push(fromInput);
      if (message.role === "user" && part.type === "text" && typeof part.text === "string") {
        const match = part.text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        if (match && isValidEmail(match[0])) fromUsers.push(match[0]);
      }
    }
  }
  return fromTools.at(-1) || fromUsers.at(-1) || "";
}

export function fallbackLeadSummary(messages: readonly LeadScanMessage[]): string {
  const lines: string[] = [];
  for (const message of messages.slice(-6)) {
    const text = messageText(message).trim();
    if (!text) continue;
    const who = message.role === "user" ? "Besøker" : "Assistent";
    lines.push(`${who}: ${text}`);
  }
  const joined = lines.join("\n").trim();
  if (!joined) return "Besøkeren ba om å sende samtalen.";
  return joined.length > 1200 ? `${joined.slice(0, 1199)}…` : joined;
}

export function buildLeadSubmission(
  existing: unknown,
  draft: LeadDraft,
  options: { explicitSend: boolean; summaryFallback?: string },
): LeadSubmission {
  const base = { ...leadInputRecord(existing) };
  const email = (draft.email || readLeadEmail(existing)).trim();
  const comment = draft.comment.trim();
  const explicitSend = options.explicitSend || isExplicitSend(existing);

  if (!isValidEmail(email)) return { ok: false, field: "email" };
  if (explicitSend && !comment) return { ok: false, field: "comment" };

  const input: Record<string, unknown> = { ...base, email };
  if (explicitSend) input.explicit_send = true;
  if (comment) {
    input.comment = comment;
    input.visitor_message = comment;
  }
  if (explicitSend) {
    if (typeof input.intent !== "string" || !input.intent.trim()) input.intent = "Send samtalen";
    if (typeof input.summary !== "string" || !input.summary.trim()) {
      input.summary = options.summaryFallback?.trim() || "Besøkeren ba om å sende samtalen.";
    }
  }
  return { ok: true, input };
}

function lastSendIntentIndex(messages: readonly LeadScanMessage[]): number {
  let found = -1;
  messages.forEach((message, index) => {
    if (isSendConversationText(messageText(message))) found = index;
  });
  return found;
}

function hasLeadPart(message: LeadScanMessage | undefined, leadPartType: string): boolean {
  return Boolean(message?.parts?.some((part) => part.type === leadPartType));
}

function hasSuccessfulLead(message: LeadScanMessage | undefined, leadPartType: string): boolean {
  return Boolean(
    message?.parts?.some((part) => part.type === leadPartType && part.state === "output-available" && part.output?.ok),
  );
}

export function leadFormSuperseded(
  messages: readonly LeadScanMessage[],
  index: number,
  leadPartType: string,
): boolean {
  for (let i = index + 1; i < messages.length; i++) {
    if (hasSuccessfulLead(messages[i], leadPartType)) return true;
  }
  return false;
}

export function hasOpenLeadForm(messages: readonly LeadScanMessage[], leadPartType: string): boolean {
  if (shouldShowStandaloneLeadForm(messages, leadPartType)) return true;
  return messages.some((message, index) => {
    if (leadFormSuperseded(messages, index, leadPartType)) return false;
    return Boolean(message.parts?.some((part) => part.type === leadPartType && leadToolView(part) === "form"));
  });
}

/**
 * Form under the transcript when the visitor is on the send path but the
 * model has not paused `capture_lead` (it only asked in prose). Hidden once
 * that tool part is on the latest assistant message, or after a successful lead.
 */
export function shouldShowStandaloneLeadForm(messages: readonly LeadScanMessage[], leadPartType: string): boolean {
  const cue = lastSendIntentIndex(messages);
  if (cue < 0) return false;
  for (let i = cue; i < messages.length; i++) {
    if (hasSuccessfulLead(messages[i], leadPartType)) return false;
  }
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && hasLeadPart(last, leadPartType)) return false;
  return true;
}

export function approvedLeadToolPart(
  leadPartType: string,
  input: Record<string, unknown>,
  ids: { toolCallId: string; approvalId: string },
) {
  return {
    type: leadPartType,
    toolCallId: ids.toolCallId,
    state: "approval-responded" as const,
    input,
    approval: { id: ids.approvalId, approved: true as const },
  };
}

type PatchableMessage = {
  id: string;
  role: string;
  parts?: ReadonlyArray<Record<string, unknown> & { type?: string; toolCallId?: string; approval?: { id?: string } }>;
};

/** Patch the paused tool call, or append an approved one the server will execute. */
export function messagesWithLeadSubmission<M extends PatchableMessage>(
  messages: readonly M[],
  leadPartType: string,
  input: Record<string, unknown>,
  target: { messageId: string; toolCallId: string; approvalId: string } | null,
  appended: { messageId: string; toolCallId: string; approvalId: string },
): M[] {
  if (target) {
    const last = messages[messages.length - 1];
    if (last && last.id === target.messageId) {
      return messages.map((message) => {
        if (message.id !== target.messageId) return message;
        return {
          ...message,
          parts: (message.parts ?? []).map((part) => {
            if (part.type !== leadPartType || part.toolCallId !== target.toolCallId) return part;
            return {
              ...part,
              state: "approval-responded",
              input,
              approval: { id: target.approvalId, approved: true },
            };
          }),
        };
      });
    }
  }
  const extra = {
    id: appended.messageId,
    role: "assistant",
    parts: [approvedLeadToolPart(leadPartType, input, appended)],
  } as unknown as M;
  return [...messages, extra];
}

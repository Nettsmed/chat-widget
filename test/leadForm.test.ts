import { describe, expect, it } from "vitest";
import {
  approvedLeadToolPart,
  buildLeadSubmission,
  findCollectedEmail,
  hasOpenLeadForm,
  isExplicitSend,
  isSendConversationText,
  leadFormSuperseded,
  leadToolView,
  messagesWithLeadSubmission,
  shouldContinueExistingApproval,
  shouldShowStandaloneLeadForm,
} from "../src/leadForm";

const LEAD = "tool-capture_lead";

describe("send-conversation detection", () => {
  it("matches the button phrase and a short ask", () => {
    expect(isSendConversationText("Send samtalen til oss")).toBe(true);
    expect(isSendConversationText("Kan du sende denne samtalen til dere?")).toBe(true);
    expect(isSendConversationText("Hva koster en nettside?")).toBe(false);
  });
});

describe("leadToolView", () => {
  it("shows the form while approval is waiting", () => {
    expect(leadToolView({ state: "approval-requested", input: { explicit_send: true } })).toBe("form");
  });

  it("shows the form again when an explicit send was refused", () => {
    expect(
      leadToolView({
        state: "output-available",
        input: { explicit_send: true, email: "a@b.no" },
        output: { ok: false, message: "Mangler kommentar" },
      }),
    ).toBe("form");
  });

  it("keeps a successful lead as success, not a form", () => {
    expect(
      leadToolView({
        state: "output-available",
        input: { explicit_send: true, comment: "Hei" },
        output: { ok: true, message: "Sendt" },
      }),
    ).toBe("success");
  });

  it("does not interrupt a normal in-flight lead with a form", () => {
    expect(leadToolView({ state: "input-available", input: { email: "a@b.no" } })).toBe("saving");
  });
});

describe("buildLeadSubmission", () => {
  it("refuses an explicit send with an empty comment", () => {
    const result = buildLeadSubmission({ email: "a@b.no", explicit_send: true }, { email: "a@b.no", comment: "   " }, {
      explicitSend: true,
    });
    expect(result).toEqual({ ok: false, field: "comment" });
  });

  it("puts comment and visitor_message on an explicit send and keeps the model summary", () => {
    const result = buildLeadSubmission(
      { email: "old@b.no", intent: "pris", summary: "Vil ha nettbutikk" },
      { email: "ny@b.no", comment: "Ring meg om WooCommerce" },
      { explicitSend: true, summaryFallback: "unused" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toMatchObject({
      email: "ny@b.no",
      comment: "Ring meg om WooCommerce",
      visitor_message: "Ring meg om WooCommerce",
      explicit_send: true,
      intent: "pris",
      summary: "Vil ha nettbutikk",
    });
    expect(isExplicitSend(result.input)).toBe(true);
  });

  it("does not force explicit_send on a normal lead", () => {
    const result = buildLeadSubmission({ intent: "pris" }, { email: "a@b.no", comment: "" }, { explicitSend: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.explicit_send).toBeUndefined();
    expect(result.input.comment).toBeUndefined();
  });
});

describe("messagesWithLeadSubmission", () => {
  it("continues a paused approval with the visitor comment", () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Send samtalen til oss" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Jeg sender den." },
          {
            type: LEAD,
            toolCallId: "call-1",
            state: "approval-requested",
            input: { email: "a@b.no", explicit_send: true, summary: "Kort" },
            approval: { id: "appr-1" },
          },
        ],
      },
    ];
    expect(shouldContinueExistingApproval(messages[1].parts[1], true)).toBe(true);
    const next = messagesWithLeadSubmission(
      messages,
      LEAD,
      { email: "a@b.no", comment: "Følg opp tilbudet", visitor_message: "Følg opp tilbudet", explicit_send: true },
      { messageId: "a1", toolCallId: "call-1", approvalId: "appr-1" },
      { messageId: "unused", toolCallId: "unused", approvalId: "unused" },
    );
    expect(next).toHaveLength(2);
    const part = next[1].parts?.[1] as { state: string; input: { comment: string; explicit_send: boolean }; approval: { approved: boolean } };
    expect(part.state).toBe("approval-responded");
    expect(part.input.comment).toBe("Følg opp tilbudet");
    expect(part.input.explicit_send).toBe(true);
    expect(part.approval.approved).toBe(true);
  });

  it("appends an approved tool part when the model only asked in prose", () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Kan du sende samtalen?" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Ja, jeg kan sende samtalen til oss." }] },
    ];
    expect(shouldShowStandaloneLeadForm(messages, LEAD)).toBe(true);
    const input = {
      email: "a@b.no",
      comment: "Trenger hjelp med checkout",
      visitor_message: "Trenger hjelp med checkout",
      explicit_send: true,
    };
    const next = messagesWithLeadSubmission(messages, LEAD, input, null, {
      messageId: "lead-1",
      toolCallId: "call-9",
      approvalId: "appr-9",
    });
    expect(next).toHaveLength(3);
    expect(next[2].role).toBe("assistant");
    expect(next[2].parts?.[0]).toEqual(approvedLeadToolPart(LEAD, input, { toolCallId: "call-9", approvalId: "appr-9" }));
    expect(shouldShowStandaloneLeadForm(next, LEAD)).toBe(false);
  });

  it("hides the prose form after a successful lead and drops a superseded refusal form", () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Send samtalen til oss" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: LEAD,
            state: "output-available",
            input: { explicit_send: true },
            output: { ok: false },
          },
        ],
      },
      {
        id: "a2",
        role: "assistant",
        parts: [{ type: LEAD, state: "output-available", input: { explicit_send: true }, output: { ok: true } }],
      },
    ];
    expect(shouldShowStandaloneLeadForm(messages, LEAD)).toBe(false);
    expect(leadFormSuperseded(messages, 1, LEAD)).toBe(true);
    expect(hasOpenLeadForm(messages, LEAD)).toBe(false);
  });
});

describe("findCollectedEmail", () => {
  it("prefers the embed query email, then a user-typed address", () => {
    expect(findCollectedEmail([], "sf@nettsmed.no")).toBe("sf@nettsmed.no");
    expect(
      findCollectedEmail([
        { role: "assistant", parts: [{ type: "text", text: "Skriv til post@nettsmed.no" }] },
        { role: "user", parts: [{ type: "text", text: "Min er kari@firma.no" }] },
      ]),
    ).toBe("kari@firma.no");
  });
});

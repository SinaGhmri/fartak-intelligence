// POST /api/fartak/lead — the project handoff endpoint (the module's most
// important security boundary).
//
// Server-enforced chain: anonymous session → conversation ownership →
// brief exists → brief belongs to THAT conversation → brief is confirmed →
// contact validated against server config → single idempotent Lead.
// The confirmation gate cannot be bypassed here: this endpoint never
// confirms or rewrites a brief (client `briefUpdates` is intentionally
// ignored — edits were applied at confirmation), and `projectReference` is
// always server-generated. Errors are generic; details stay in the log.

import { NextRequest, NextResponse } from "next/server";
import { serverConfig } from "../../../../server/fartak/config";
import { rateLimit, rateKey } from "../../../../server/fartak/rateLimit";
import {
  resolveAnonymousSession,
  attachSessionCookie,
  isTrustedOrigin,
  type AnonymousSession,
} from "../../../../server/fartak/session";
import {
  ApiError,
  MAX_BODY_BYTES,
  readJsonBody,
  validateContact,
  clientString,
} from "../../../../server/fartak/validation";
import {
  findLeadByConversation,
  generateProjectReference,
  getBrief,
  getConversationForOwner,
  listMessages,
  updateConversation,
} from "../../../../server/fartak/storage";
import { finalizeHandoff, isUniqueViolation } from "../../../../server/fartak/briefLifecycle";
import { getLLMProvider } from "../../../../server/fartak/provider";

export const runtime = "nodejs";

// Compose the conversation summary for the handoff. Prefers an AI summary of
// the discovery transcript; falls back to a deterministic composition so the
// handoff never fails because of the provider.
async function summarizeConversation(
  transcript: string,
  projectName: string | null
): Promise<string> {
  try {
    const provider = getLLMProvider();
    const raw = await provider.complete(
      `Summarize this project discovery conversation in 3-4 sentences for a software team receiving the lead. Focus on what the visitor wants and the key decisions. Transcript:\n\n${transcript.slice(0, 6000)}`,
      {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      }
    );
    const parsed = raw as { summary?: unknown };
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    if (summary) return summary.slice(0, 1200);
  } catch {
    // Provider unavailable — use the deterministic summary below.
  }
  return `${projectName || "Project"} — discovery conversation. The structured Project Brief attached to this lead contains the confirmed requirements, assumptions, and open questions.`;
}

// Optional duplicate-request key (X-Fartak-Idempotency-Key): protection
// ONLY — never authentication. Ownership comes from the session cookie.
function readIdempotencyKey(headers: Headers): string | null {
  const raw = headers.get("x-fartak-idempotency-key");
  if (!raw) return null;
  const key = raw.trim().slice(0, 128);
  return /^[A-Za-z0-9._:-]{8,128}$/.test(key) ? key : null;
}

export async function POST(req: NextRequest) {
  let session: AnonymousSession | null = null;
  const respond = (payload: Record<string, unknown>, status = 200) => {
    const res = NextResponse.json(payload, { status });
    if (session) attachSessionCookie(res, session);
    return res;
  };

  try {
    if (!isTrustedOrigin(req)) return respond({ error: "Invalid request origin" }, 403);

    session = resolveAnonymousSession(req);
    if (!rateLimit(`lead:${rateKey(req)}`)) {
      return respond({ error: "Rate limit exceeded. Please slow down." }, 429);
    }

    const body = await readJsonBody(req, MAX_BODY_BYTES.lead);
    const conversationId = clientString(body.conversationId, 100);
    if (!conversationId) return respond({ error: "Missing conversation" }, 400);

    // 1–2: conversation exists AND belongs to this anonymous session.
    // Unknown and foreign ids return the same generic 404.
    const conversation = await getConversationForOwner(conversationId, session.hash);
    if (!conversation) return respond({ error: "Conversation not found" }, 404);

    // Idempotency (early): a conversation that already handed off returns its
    // existing result — double-clicks, browser/network retries and repeated
    // submissions never create a second Lead and never error the client.
    const existingLead = await findLeadByConversation(conversation.id);
    if (existingLead) {
      const existingBrief = existingLead.projectBriefId
        ? await getBrief(existingLead.projectBriefId)
        : null;
      return respond({
        ok: true,
        leadId: existingLead.id,
        projectReference: existingLead.projectReference,
        projectName: existingBrief?.project_name ?? null,
        preferredContactMethod: existingLead.preferredContactMethod,
      });
    }
    // 3: server-authoritative lifecycle — completed with no lead row is a
    // conflict, never a fresh handoff.
    if (conversation.status === "completed") {
      return respond({ error: "Conversation already completed" }, 409);
    }

    // 4–6: brief exists, belongs to THIS conversation, is the AUTHORITATIVE
    // brief (Conversation.briefId), and is confirmed. A mismatched
    // Conversation A + Brief B pair is rejected, never attached.
    const clientBriefId = clientString(body.briefId, 100);
    const briefRef = clientBriefId || conversation.briefId || "";
    if (!briefRef) return respond({ error: "Brief not found" }, 404);
    const brief = await getBrief(briefRef);
    if (!brief || brief.conversation_id !== conversation.id) {
      return respond({ error: "Brief not found" }, 404);
    }
    if (conversation.briefId && brief.id !== conversation.briefId) {
      return respond({ error: "Brief not found" }, 404);
    }
    // Self-heal the same drift the lifecycle module tolerates (invariant A):
    // a legacy row whose pointer was never assigned. Only healed when it
    // stays inside THIS conversation, and only before handoff commits.
    if (!conversation.briefId) {
      await updateConversation(conversation.id, { briefId: brief.id });
    }
    // A LOCKED brief means the handoff already happened (locked and the Lead
    // commit atomically in finalizeHandoff). A concurrent retry that raced the
    // winner must therefore return the EXISTING handoff result idempotently —
    // not an error (Phase 1 guarantee: retries after success are safe).
    if (brief.status === "locked") {
      const existing = await findLeadByConversation(conversation.id);
      if (existing) {
        return respond({
          ok: true,
          leadId: existing.id,
          projectReference: existing.projectReference,
          projectName: brief.project_name ?? null,
          preferredContactMethod: existing.preferredContactMethod,
        });
      }
      // Locked without a Lead is an inconsistent row — never create a second.
      return respond({ error: "Conversation already completed" }, 409);
    }
    if (brief.status !== "confirmed") {
      return respond({ error: "Project brief must be confirmed first" }, 403);
    }

    // 7–8: contact validated against server configuration (the frontend list
    // is never trusted). `briefUpdates` in this payload is ignored on
    // purpose: edits were applied during confirmation — no hidden
    // confirmation bypass, no rewrite of a confirmed brief.
    const contact = validateContact(body);

    // AI context for the handoff: summary over the full server-side transcript.
    const messages = await listMessages(conversation.id, 200);
    const transcript = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role === "user" ? "visitor" : "fartak"}: ${m.content}`)
      .join("\n");
    const summary = await summarizeConversation(transcript, brief.project_name ?? null);

    // 9: at most one handoff per conversation, applied ATOMICALLY —
    // finalizeHandoff() locks the brief (confirmed → locked), inserts the
    // Lead, and completes the conversation in one transaction. On a unique-
    // constraint race the loser rolls back and returns the winner's result;
    // a projectReference collision regenerates and retries. If the brief was
    // edited concurrently, finalizeHandoff aborts with 409 — never a Lead
    // referencing a mutable brief. Client projectReference/status/confirmedAt
    // are never read.
    const idempotencyKey = readIdempotencyKey(req.headers);
    let lead = null;
    for (let attempt = 0; attempt < 3 && !lead; attempt++) {
      try {
        lead = await finalizeHandoff({
          conversationId: conversation.id,
          briefId: brief.id,
          projectReference: await generateProjectReference(serverConfig.referencePrefix),
          contact,
          summary,
          idempotencyKey,
        });
      } catch (error) {
        if (error instanceof ApiError) throw error; // 409 lifecycle conflict → safe response
        if (!isUniqueViolation(error)) throw error;
        const winner = await findLeadByConversation(conversation.id);
        if (winner) {
          lead = winner;
          break;
        }
        // Still unique-conflicting after retries (e.g. an idempotency key
        // reused across conversations) — reject generically, leak nothing.
        if (attempt === 2) return respond({ error: "Duplicate submission rejected" }, 409);
      }
    }
    if (!lead) return respond({ error: "Something went wrong" }, 500);

    return respond({
      ok: true,
      leadId: lead.id,
      projectReference: lead.projectReference,
      projectName: brief.project_name ?? null,
      preferredContactMethod: contact.preferredContactMethod,
    });
  } catch (error) {
    if (error instanceof ApiError) return respond({ error: error.userMessage }, error.status);
    console.error("[fartak/lead]", error);
    return respond({ error: "Something went wrong" }, 500);
  }
}


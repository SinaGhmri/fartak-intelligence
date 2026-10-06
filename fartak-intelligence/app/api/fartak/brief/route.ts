// POST /api/fartak/brief — explicit final confirmation of the Project Brief.
//
// Authorization chain (server-enforced): anonymous session cookie →
// conversation ownership → brief.conversationId match. The briefId is only
// an identifier; it is never proof of ownership, and a foreign or unknown
// brief yields the same generic 404.
//
// Server-authoritative transition: draft → confirmed. `status` and
// `confirmedAt` are generated here; nothing the client sends can set them,
// and an already-confirmed brief is returned as-is (idempotent retries, no
// rewrite-after-confirm).
//
// The previous public GET /api/fartak/brief?briefId= has been REMOVED: the
// frontend never used it, and no public read of brief data by id exists.

import { NextRequest, NextResponse } from "next/server";
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
  clientString,
  sanitizeBriefEdits,
} from "../../../../server/fartak/validation";
import { getConversationForOwner, getBrief } from "../../../../server/fartak/storage";
import { confirmProjectBrief } from "../../../../server/fartak/briefLifecycle";

export const runtime = "nodejs";

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
    if (!rateLimit(`brief:${rateKey(req)}`)) {
      return respond({ error: "Rate limit exceeded. Please slow down." }, 429);
    }

    const body = await readJsonBody(req, MAX_BODY_BYTES.brief);
    const briefId = clientString(body.briefId, 100);
    const clientConversationId = clientString(body.conversationId, 100);
    if (!briefId) return respond({ error: "Missing brief" }, 400);

    // Load → relate → verify ownership: brief → conversation → session.
    const brief = await getBrief(briefId);
    if (!brief) return respond({ error: "Brief not found" }, 404);
    // If the client also names a conversation, it must be the brief's real
    // conversation — a mismatched pair is rejected, never silently attached.
    if (clientConversationId && clientConversationId !== brief.conversation_id) {
      return respond({ error: "Brief not found" }, 404);
    }
    const conversation = await getConversationForOwner(brief.conversation_id, session.hash);
    if (!conversation) return respond({ error: "Brief not found" }, 404);

    // Lifecycle gates before confirmation (server-authoritative):
    //  • locked briefs are immutable (409)
    //  • completed conversations accept no new confirmations, but an
    //    unchanged confirmed brief stays idempotent (Phase 1 behavior)
    if (brief.status === "locked") {
      return respond({ error: "Project brief is locked" }, 409);
    }
    const hasEdits = Object.keys(sanitizeBriefEdits(body.briefUpdates)).length > 0;
    if (conversation.status === "completed" && (brief.status !== "confirmed" || hasEdits)) {
      return respond({ error: "Conversation already completed" }, 409);
    }

    // confirmProjectBrief() applies pending edits FIRST (content changes
    // invalidate a previous confirmation and require this re-confirmation),
    // validates readiness, then performs the draft/review → confirmed
    // transition with a server-generated confirmedAt. Repeating the same
    // confirmation is idempotent. Client `status`/`confirmedAt` are never read.
    const confirmed = await confirmProjectBrief(conversation.id, body.briefUpdates);

    return respond({ ok: true, brief: confirmed });
  } catch (error) {
    if (error instanceof ApiError) return respond({ error: error.userMessage }, error.status);
    console.error("[fartak/brief]", error);
    return respond({ error: "Something went wrong" }, 500);
  }
}

// POST /api/fartak/chat — the conversation engine endpoint.
// Security order: origin check → anonymous session → rate limit → bounded
// body → conversation OWNERSHIP (ids are never trusted on their own) →
// persistence → RAG → controlled agent loop. AI provider and all data access
// stay server-side; unexpected errors are logged and returned as generic 500s.

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
  clientString,
} from "../../../../server/fartak/validation";
import {
  getConversationForOwner, createConversation, createMessage,
  listMessages, incrementMessageCount,
} from "../../../../server/fartak/storage";
import { retrieveKnowledge } from "../../../../server/fartak/knowledge";
import { buildSystemPrompt } from "../../../../server/fartak/systemPrompt";
import { runAgentLoop } from "../../../../server/fartak/agent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let session: AnonymousSession | null = null;
  // Every response path goes through here so a first-time visitor receives
  // their HttpOnly session cookie even on error responses.
  const respond = (payload: Record<string, unknown>, status = 200) => {
    const res = NextResponse.json(payload, { status });
    if (session) attachSessionCookie(res, session);
    return res;
  };

  try {
    if (!isTrustedOrigin(req)) return respond({ error: "Invalid request origin" }, 403);

    session = resolveAnonymousSession(req);
    if (!rateLimit(`chat:${rateKey(req)}`)) {
      return respond({ error: "Rate limit exceeded. Please slow down." }, 429);
    }

    const body = await readJsonBody(req, MAX_BODY_BYTES.chat);
    const message = clientString(body.message, serverConfig.maxMessageLength);
    const intent = clientString(body.intent, 60);
    if (!message && !intent) return respond({ error: "Empty message" }, 400);

    // Conversation lookup: a client-supplied id must belong to THIS anonymous
    // session. Unknown ids and foreign ids produce the same generic 404, so
    // the response never reveals whether someone else's conversation exists.
    const requestedId = clientString(body.conversationId, 100);
    const conversation = requestedId
      ? await getConversationForOwner(requestedId, session.hash)
      : await createConversation({
          intent,
          title: message.slice(0, 60) || (intent ? intent : "New conversation"),
          ownerTokenHash: session.hash,
        });
    if (!conversation) return respond({ error: "Conversation not found" }, 404);

    // Server-authoritative lifecycle: a completed (handed-off) conversation
    // cannot be reused for a new exchange.
    if (conversation.status === "completed") {
      return respond({ error: "Conversation already completed" }, 409);
    }

    const conversationId = conversation.id;

    if (message) {
      await createMessage({ conversationId, role: "user", content: message });
    }

    const history = await listMessages(conversationId, serverConfig.maxHistory);

    // RAG: retrieve verified company knowledge for this message.
    const kbContext = await retrieveKnowledge(message, 8);
    const systemPrompt = buildSystemPrompt(kbContext);

    const { assistantText, actions, brief, readiness } = await runAgentLoop({
      conversationId,
      systemPrompt,
      history: history.map((m) => ({ role: m.role, content: m.content })),
      latestUserMessage: message,
    });
    const finalText = assistantText || "I've put that together for you.";

    await createMessage({
      conversationId,
      role: "assistant",
      content: finalText,
      cards: JSON.stringify(actions),
    });
    await incrementMessageCount(conversationId, 1 + actions.length);
    // Chat replies may carry a brief — it was created/updated through the
    // lifecycle module, which maintains Conversation.briefId atomically.

    return respond({ conversationId, message: finalText, actions, brief, readiness });
  } catch (error) {
    if (error instanceof ApiError) return respond({ error: error.userMessage }, error.status);
    // Details stay in the server log; visitors only ever see a generic message.
    console.error("[fartak/chat]", error);
    return respond({ error: "Something went wrong" }, 500);
  }
}

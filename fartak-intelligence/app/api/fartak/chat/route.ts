// POST /api/fartak/chat — the conversation engine endpoint.
// Handles: rate limiting, validation, conversation + history persistence,
// RAG retrieval, the controlled agent loop, and tool execution.
// The AI provider and all data access stay server-side.

import { NextRequest, NextResponse } from "next/server";
import { serverConfig } from "../../../../server/fartak/config";
import { rateLimit, clientKey } from "../../../../server/fartak/rateLimit";
import {
  getConversation, createConversation, createMessage,
  listMessages, updateConversation, incrementMessageCount,
} from "../../../../server/fartak/storage";
import { retrieveKnowledge } from "../../../../server/fartak/knowledge";
import { buildSystemPrompt } from "../../../../server/fartak/systemPrompt";
import { runAgentLoop } from "../../../../server/fartak/agent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    if (!rateLimit(`chat:${clientKey(req.headers)}`)) {
      return NextResponse.json({ error: "Rate limit exceeded. Please slow down." }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const message = (body.message || "").toString().slice(0, serverConfig.maxMessageLength).trim();
    const intent = (body.intent || "").toString().slice(0, 60);
    if (!message && !intent) {
      return NextResponse.json({ error: "Empty message" }, { status: 400 });
    }

    // Get or create the conversation.
    let conversation = body.conversationId ? await getConversation(String(body.conversationId)) : null;
    if (!conversation) {
      conversation = await createConversation({
        intent,
        title: message.slice(0, 60) || (intent ? intent : "New conversation"),
      });
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
    if (brief) await updateConversation(conversationId, { briefId: brief.id });

    return NextResponse.json({ conversationId, message: finalText, actions, brief, readiness });
  } catch (error) {
    console.error("[fartak/chat]", error);
    const msg = error instanceof Error ? error.message : "Conversation error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
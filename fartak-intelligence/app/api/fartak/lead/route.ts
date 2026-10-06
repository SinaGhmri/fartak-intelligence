// POST /api/fartak/lead — the project handoff endpoint.
// A lead is NEVER created by the AI; it is only created here, after the
// visitor explicitly confirmed the brief and submitted the contact form.
// Requirements: full name + mobile phone; email only required when the
// visitor chose email as their preferred contact method. The handoff
// persists the complete discovery context (brief + conversation + messages
// + AI summary) so the team can see how the brief was created.

import { NextRequest, NextResponse } from "next/server";
import { serverConfig } from "../../../../server/fartak/config";
import { rateLimit, clientKey } from "../../../../server/fartak/rateLimit";
import {
  createLead,
  generateProjectReference,
  getBrief,
  listMessages,
  updateBrief,
  updateConversation,
} from "../../../../server/fartak/storage";
import { getLLMProvider } from "../../../../server/fartak/provider";
import type { ProjectBriefEdits } from "../../../../lib/fartak/types";

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

export async function POST(req: NextRequest) {
  try {
    if (!rateLimit(`lead:${clientKey(req.headers)}`)) {
      return NextResponse.json({ error: "Rate limit exceeded. Please slow down." }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const conversationId = (body.conversationId || "").toString().trim().slice(0, 100);
    const name = (body.name || "").toString().trim().slice(0, 120);
    const phone = (body.phone || "").toString().trim().slice(0, 60);
    const email = (body.email || "").toString().trim().slice(0, 200);
    const preferredContactMethod = (body.preferredContactMethod || "").toString().trim().slice(0, 30);
    const briefId = (body.briefId || "").toString().trim().slice(0, 100);
    const briefUpdates = body.briefUpdates as ProjectBriefEdits | null | undefined;

    if (!conversationId) return NextResponse.json({ error: "Missing conversation" }, { status: 400 });
    if (!name || !phone) {
      return NextResponse.json({ error: "Name and phone number are required" }, { status: 400 });
    }
    if (phone.replace(/\D/g, "").length < 7) {
      return NextResponse.json({ error: "Please provide a valid phone number" }, { status: 400 });
    }
    if (!preferredContactMethod || !serverConfig.contactMethods.includes(preferredContactMethod)) {
      return NextResponse.json({ error: "Unsupported contact method" }, { status: 400 });
    }
    // Email is optional — unless the visitor chose email as the contact method.
    if (preferredContactMethod === "email") {
      if (!email) {
        return NextResponse.json({ error: "Email is required for email contact" }, { status: 400 });
      }
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    // Apply the visitor's brief edits (if any), then mark the brief confirmed.
    if (briefId) {
      await updateBrief(briefId, briefUpdates && typeof briefUpdates === "object" ? briefUpdates : {}, true);
    }

    // AI context for the handoff: summary over the full server-side transcript.
    const brief = briefId ? await getBrief(briefId) : null;
    const messages = await listMessages(conversationId, 200);
    const transcript = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role === "user" ? "visitor" : "fartak"}: ${m.content}`)
      .join("\n");
    const summary = await summarizeConversation(transcript, brief?.project_name ?? null);

    const projectReference = await generateProjectReference(serverConfig.referencePrefix);
    const lead = await createLead({
      conversationId,
      projectBriefId: briefId || null,
      projectReference,
      name,
      phone,
      email: email || null,
      preferredContactMethod,
    });

    await updateConversation(conversationId, {
      leadId: lead.id,
      status: "completed",
      summary,
    });

    return NextResponse.json({
      ok: true,
      leadId: lead.id,
      projectReference,
      projectName: brief?.project_name ?? null,
      preferredContactMethod,
    });
  } catch (error) {
    console.error("[fartak/lead]", error);
    const msg = error instanceof Error ? error.message : "Lead submission error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
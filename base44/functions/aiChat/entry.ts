// Fartak Intelligence — Conversation Engine + Agent.
// Provider-independent: the model is selected here (FARTAK_MODEL), never in the UI.
// API keys live server-side (Base44 managed InvokeLLM). No secrets reach the client.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { buildSystemPrompt } from "../../shared/fartak/systemPrompt.ts";
import { retrieveKnowledge } from "../../shared/fartak/knowledge.ts";
import {
  searchCompany,
  searchProjects,
  searchServices,
  showProject,
  showService,
  createBrief,
  navigateTo,
  NAV_TARGETS,
} from "../../shared/fartak/tools.ts";

// Configurable AI provider/model. Change here without touching the frontend.
const FARTAK_MODEL = "automatic"; // provider-independent: change here, not in the UI. "claude-sonnet-5" gives more reliable brief extraction.
const MAX_MESSAGE_LENGTH = 2000;
const MAX_AGENT_TURNS = 4;
const MAX_HISTORY = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

// Explicit typed action channels — far more reliable than a generic toolArgs
// object with this platform's InvokeLLM. Each channel maps to a validated tool.
const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "Text shown to the visitor" },
    brief: {
      type: "object",
      description: "Populate to create a project brief. Use every field the visitor provided; do not leave required fields empty.",
      properties: {
        project_name: { type: "string" },
        goal: { type: "string" },
        target_users: { type: "string" },
        platform: { type: "string" },
        features: { type: "array", items: { type: "string" } },
        ai_requirements: { type: "string" },
        stage: { type: "string" },
        timeline: { type: "string" },
        notes: { type: "string" },
      },
    },
    show: {
      type: "object",
      description: "Populate to display a project or service card.",
      properties: {
        kind: { type: "string", enum: ["project", "service"] },
        id: { type: "string" },
      },
    },
    navigate: {
      type: "string",
      description: "Populate to request navigation to an approved destination.",
      enum: NAV_TARGETS,
    },
    search: {
      type: "object",
      description: "Populate to search verified company knowledge before answering.",
      properties: {
        kind: { type: "string", enum: ["company", "projects", "services"] },
        query: { type: "string" },
      },
    },
  },
  required: ["reply"],
};

// In-memory per-IP rate limiting (best-effort; per-instance).
const rateBuckets = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, reset: now + RATE_LIMIT_WINDOW_MS };
  if (now > bucket.reset) {
    bucket.count = 0;
    bucket.reset = now + RATE_LIMIT_WINDOW_MS;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  return bucket.count <= RATE_LIMIT_MAX;
}

function clientIp(req) {
  const h = req.headers || {};
  return (
    (h.get && (h.get("x-forwarded-for") || h.get("cf-connecting-ip"))) ||
    "unknown"
  );
}

function safeParse(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return { reply: "" };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : { reply: value };
  } catch {
    return { reply: value };
  }
}

function buildConversationPrompt(systemPrompt, history, latestUserMessage) {
  let transcript = "";
  for (const m of history) {
    if (m.role === "user") transcript += `visitor: ${m.content}\n`;
    else if (m.role === "assistant") transcript += `fartak: ${m.content}\n`;
    else if (m.role === "tool") transcript += `tool_result: ${m.content}\n`;
  }
  if (latestUserMessage && (!history.length || history[history.length - 1].role !== "user")) {
    transcript += `visitor: ${latestUserMessage}\n`;
  }
  return `${systemPrompt}

CONVERSATION SO FAR:
${transcript || "(none yet)"}

Respond now with a single JSON object. Populate "reply" always. Populate exactly one action channel ("search", "show", "navigate", or "brief") only when it should run now. When creating a brief, fill EVERY brief field from what the visitor told you — never leave project_name, goal, target_users, platform, or features empty.`;
}

function briefIsMeaningful(brief) {
  if (!brief || typeof brief !== "object") return false;
  return !!asString(brief.project_name) && asString(brief.project_name) !== "Untitled project";
}
function asString(v, max = 1000) {
  if (v == null) return "";
  return String(v).slice(0, max);
}

async function runAgentLoop(base44, systemPrompt, history, latestUserMessage, conversationId) {
  const actions = [];
  let brief = null;
  let assistantText = "";
  const workingHistory = [...history];
  const svc = base44.asServiceRole.entities;

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const prompt = buildConversationPrompt(systemPrompt, workingHistory, latestUserMessage);
    const llm = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: REPLY_SCHEMA,
      model: FARTAK_MODEL,
    });
    const parsed = safeParse(llm);
    if (parsed.reply) assistantText = parsed.reply;

    let actionTaken = false;

    // 1) Search (feeds context back to the model — continue loop).
    if (parsed.search && parsed.search.kind) {
      actionTaken = true;
      let result;
      if (parsed.search.kind === "company") result = await searchCompany(base44, parsed.search.query);
      else if (parsed.search.kind === "projects") result = await searchProjects(base44, parsed.search.query);
      else result = await searchServices(base44, parsed.search.query);
      await svc.Message.create({
        conversation_id: conversationId,
        role: "tool",
        content: JSON.stringify({ search: parsed.search.kind, result: result.text || "" }).slice(0, 2000),
        tool_name: "search_" + parsed.search.kind,
        tool_args: JSON.stringify(parsed.search),
      }).catch(() => {});
      workingHistory.push({ role: "tool", content: String(result.text || "").slice(0, 1500) });
      continue;
    }

    // 2) Show a project/service card.
    if (parsed.show && parsed.show.kind && parsed.show.id) {
      actionTaken = true;
      const result =
        parsed.show.kind === "project"
          ? await showProject(base44, parsed.show.id)
          : await showService(base44, parsed.show.id);
      if (result.type === "action") {
        actions.push(result.action);
        workingHistory.push({ role: "tool", content: `Displayed ${parsed.show.kind} card: ${parsed.show.id}` });
      } else {
        workingHistory.push({ role: "tool", content: String(result.text || "").slice(0, 500) });
      }
      if (parsed.reply) break;
      continue;
    }

    // 3) Navigate.
    if (parsed.navigate && NAV_TARGETS.includes(parsed.navigate)) {
      actionTaken = true;
      const result = navigateTo(parsed.navigate);
      if (result) {
        actions.push(result.action);
        workingHistory.push({ role: "tool", content: `Navigated to ${parsed.navigate}` });
      }
      if (parsed.reply) break;
      continue;
    }

    // 4) Create project brief.
    if (briefIsMeaningful(parsed.brief)) {
      actionTaken = true;
      const result = await createBrief(base44, parsed.brief, conversationId);
      actions.push(result.action);
      brief = result.brief;
      await svc.Message.create({
        conversation_id: conversationId,
        role: "tool",
        content: JSON.stringify({ tool: "create_project_brief", brief_id: brief.id }).slice(0, 2000),
        tool_name: "create_project_brief",
        tool_args: JSON.stringify(parsed.brief),
      }).catch(() => {});
      if (parsed.reply) break;
      continue;
    }

    if (!actionTaken) break; // pure text reply
  }

  return { assistantText, actions, brief };
}

export default async function (req) {
  try {
    const ip = clientIp(req);
    if (!rateLimit(ip)) {
      return Response.json({ error: "Rate limit exceeded. Please slow down." }, { status: 429 });
    }

    const base44 = createClientFromRequest(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      user = null;
    }
    const svc = base44.asServiceRole.entities;

    const body = await req.json().catch(() => ({}));
    const action = body.action || "chat";

    if (action === "submit_lead") {
      return await handleSubmitLead(base44, body, user);
    }

    const message = (body.message || "").toString().slice(0, MAX_MESSAGE_LENGTH).trim();
    if (!message && !body.intent) {
      return Response.json({ error: "Empty message" }, { status: 400 });
    }

    let conversation = null;
    if (body.conversationId) {
      conversation = await svc.Conversation.get(body.conversationId).catch(() => null);
    }
    if (!conversation) {
      conversation = await svc.Conversation.create({
        status: "active",
        intent: body.intent || "",
        title: message.slice(0, 60) || (body.intent ? body.intent : "New conversation"),
      });
    }
    const conversationId = conversation.id;

    if (message) {
      await svc.Message.create({
        conversation_id: conversationId,
        role: "user",
        content: message,
      });
    }

    const recent = await svc.Message.filter({ conversation_id: conversationId }, "-created_date", MAX_HISTORY);
    const history = (recent || []).reverse();

    const kbContext = await retrieveKnowledge(base44, message, 8);
    const systemPrompt = buildSystemPrompt(kbContext);

    const { assistantText, actions, brief } = await runAgentLoop(base44, systemPrompt, history, message, conversationId);
    const finalText = assistantText || "I've put that together for you.";

    await svc.Message.create({
      conversation_id: conversationId,
      role: "assistant",
      content: finalText,
      cards: JSON.stringify(actions),
    });

    const newCount = (conversation.message_count || 0) + 1 + actions.length;
    await svc.Conversation.update(conversationId, { message_count: newCount });

    return Response.json({ conversationId, message: finalText, actions, brief });
  } catch (error) {
    console.error("aiChat error:", error);
    return Response.json({ error: error.message || "Conversation error" }, { status: 500 });
  }
}

async function handleSubmitLead(base44, body, user) {
  const svc = base44.asServiceRole.entities;
  const conversationId = (body.conversationId || "").toString().trim();
  const name = (body.name || "").toString().trim().slice(0, 120);
  const email = (body.email || "").toString().trim().slice(0, 200);
  const phone = (body.phone || "").toString().trim().slice(0, 60);
  const company = (body.company || "").toString().trim().slice(0, 200);
  const message = (body.message || "").toString().trim().slice(0, 2000);
  const briefId = (body.project_brief_id || body.briefId || "").toString().trim();

  if (!conversationId) return Response.json({ error: "Missing conversation" }, { status: 400 });
  if (!name || !email) return Response.json({ error: "Name and email are required" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Invalid email" }, { status: 400 });

  const lead = await svc.Lead.create({
    conversation_id: conversationId,
    project_brief_id: briefId || undefined,
    name,
    email,
    phone,
    company,
    message,
    status: "new",
  });

  // Apply visitor edits to the brief, then mark it confirmed.
  if (briefId) {
    const updates = body.brief_updates;
    if (updates && typeof updates === "object") {
      const safe = {};
      for (const k of ["project_name", "goal", "target_users", "platform", "ai_requirements", "stage", "timeline", "notes"]) {
        if (typeof updates[k] === "string") safe[k] = updates[k].slice(0, 1000);
      }
      if (Array.isArray(updates.features)) {
        safe.features = updates.features.map((f) => String(f).slice(0, 200)).filter(Boolean).slice(0, 12);
      }
      safe.status = "confirmed";
      await svc.ProjectBrief.update(briefId, safe).catch(() => {});
    } else {
      await svc.ProjectBrief.update(briefId, { status: "confirmed" }).catch(() => {});
    }
  }

  await svc.Conversation.update(conversationId, { lead_id: lead.id, status: "completed" }).catch(() => {});

  return Response.json({ ok: true, leadId: lead.id });
}
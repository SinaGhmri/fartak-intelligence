// Controlled agent loop. The model emits explicit typed action channels
// (search / show / navigate / brief) mapped to validated tools — never
// arbitrary code, DOM access, or unrestricted navigation.

import { serverConfig } from "./config";
import { getLLMProvider, safeParse } from "./provider";
import {
  searchCompany, searchProjects, searchServices,
  showProject, showService,
  createProjectBrief, navigateTo, briefIsMeaningful, NAV_TARGETS,
} from "./tools";
import { createMessage } from "./storage";
import type { AgentAction, ProjectBrief, ReadinessState } from "../../lib/fartak/types";

export interface HistoryMessage {
  role: string;
  content: string;
}

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "Text shown to the visitor" },
    search: {
      type: "object",
      description: "Populate to search verified company knowledge before answering.",
      properties: { kind: { type: "string", enum: ["company", "projects", "services"] }, query: { type: "string" } },
    },
    show: {
      type: "object",
      description: "Populate to display a project or service card.",
      properties: { kind: { type: "string", enum: ["project", "service"] }, id: { type: "string" } },
    },
    navigate: { type: "string", description: "Populate to request host-site navigation.", enum: NAV_TARGETS },
    readiness: {
      type: "object",
      description:
        "Internal readiness evaluation, not an action. Fill whenever you assess whether the project has enough information for a meaningful handoff. Never expose a numeric score.",
      properties: {
        ready: { type: "boolean" },
        missingCritical: { type: "array", items: { type: "string" } },
        missingOptional: { type: "array", items: { type: "string" } },
      },
    },
    brief: {
      type: "object",
      description: "Populate to create the project brief. Fill every field the visitor told you.",
      properties: {
        project_name: { type: "string" },
        project_type: { type: "string" },
        problem: { type: "string" },
        goal: { type: "string" },
        target_users: { type: "string" },
        user_roles: { type: "string" },
        platform: { type: "string" },
        features: { type: "array", items: { type: "string" } },
        workflows: { type: "string" },
        ai_requirements: { type: "string" },
        integrations: { type: "string" },
        constraints: { type: "string" },
        mvp_scope: { type: "string" },
        future_scope: { type: "string" },
        assumptions: { type: "array", items: { type: "string" } },
        open_questions: { type: "array", items: { type: "string" } },
        timeline: { type: "string" },
        budget: { type: "string" },
        geographic_scope: { type: "string" },
        languages: { type: "string" },
        security_privacy: { type: "string" },
        additional_notes: { type: "string" },
      },
    },
  },
  required: ["reply"],
};

function buildConversationPrompt(
  systemPrompt: string,
  history: HistoryMessage[],
  latestUserMessage: string
) {
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

Respond now with a single JSON object. "reply" is always required. Populate exactly one action channel ("search", "show", "navigate", or "brief") only when it should run now. When sending "brief", fill every brief field from what the visitor told you — do not invent anything.`;
}

export async function runAgentLoop(params: {
  conversationId: string;
  systemPrompt: string;
  history: HistoryMessage[];
  latestUserMessage: string;
}): Promise<{
  assistantText: string;
  actions: AgentAction[];
  brief: ProjectBrief | null;
  readiness: ReadinessState | null;
}> {
  const { conversationId, systemPrompt, history, latestUserMessage } = params;
  const actions: AgentAction[] = [];
  const workingHistory = [...history];
  let assistantText = "";
  let brief: ProjectBrief | null = null;
  let readiness: ReadinessState | null = null;
  const provider = getLLMProvider();

  for (let turn = 0; turn < serverConfig.maxAgentTurns; turn++) {
    const prompt = buildConversationPrompt(systemPrompt, workingHistory, latestUserMessage);
    const raw = await provider.complete(prompt, REPLY_SCHEMA);
    const parsed = safeParse(raw) as Record<string, unknown>;
    if (typeof parsed === "string") continue;
    const reply = asString(parsed.reply);
    if (reply) assistantText = reply;
    const turnReadiness = normalizeReadiness(parsed.readiness);
    if (turnReadiness) readiness = turnReadiness;

    let actionTaken = false;

    // 1) Search — feeds context back to the model; continue the loop.
    const search = parsed.search as { kind?: string; query?: string } | undefined;
    if (search && search.kind) {
      actionTaken = true;
      let text = "";
      if (search.kind === "company") text = (await searchCompany(search.query)).text;
      else if (search.kind === "projects") text = (await searchProjects(search.query)).text;
      else text = (await searchServices(search.query)).text;
      await createMessage({
        conversationId,
        role: "tool",
        content: JSON.stringify({ search: search.kind, result: text.slice(0, 2000) }),
        toolName: `search_${search.kind}`,
        toolArgs: JSON.stringify(search),
      }).catch(() => {});
      workingHistory.push({ role: "tool", content: String(text || "").slice(0, 1500) });
      continue;
    }

    // 2) Show a project/service card.
    const show = parsed.show as { kind?: string; id?: string } | undefined;
    if (show && show.kind && show.id) {
      actionTaken = true;
      const result = show.kind === "project" ? await showProject(show.id) : await showService(show.id);
      if (result.type === "action") {
        actions.push(result.action as AgentAction);
        workingHistory.push({ role: "tool", content: `Displayed ${show.kind} card: ${show.id}` });
      } else {
        workingHistory.push({ role: "tool", content: String(result.text || "").slice(0, 500) });
      }
      if (reply) break;
      continue;
    }

    // 3) Navigate.
    const navigate = asString(parsed.navigate);
    if (navigate && NAV_TARGETS.includes(navigate)) {
      actionTaken = true;
      const result = navigateTo(navigate);
      if (result && result.type === "action") {
        actions.push(result.action);
        workingHistory.push({ role: "tool", content: `Navigated to ${navigate}` });
      }
      if (reply) break;
      continue;
    }

    // 4) Create project brief.
    if (briefIsMeaningful(parsed.brief)) {
      actionTaken = true;
      const { brief: created } = await createProjectBrief(
        parsed.brief as Record<string, unknown>,
        conversationId,
        readiness
      );
      actions.push({ type: "project_brief", brief: created });
      brief = created;
      await createMessage({
        conversationId,
        role: "tool",
        content: JSON.stringify({ tool: "create_project_brief", brief_id: created.id }),
        toolName: "create_project_brief",
        toolArgs: JSON.stringify(parsed.brief),
      }).catch(() => {});
      if (reply) break;
      continue;
    }

    if (!actionTaken) break; // pure text reply
  }

  return { assistantText, actions, brief, readiness };
}

function asString(v: unknown, max = 4000): string {
  if (v == null) return "";
  return String(v).slice(0, max);
}

function asStringArray(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").slice(0, 200)).filter(Boolean).slice(0, max);
}

function normalizeReadiness(v: unknown): ReadinessState | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  return {
    ready: !!r.ready,
    missingCritical: asStringArray(r.missingCritical ?? r.missing_critical),
    missingOptional: asStringArray(r.missingOptional ?? r.missing_optional),
  };
}
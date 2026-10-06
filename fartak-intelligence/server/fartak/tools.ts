// Controlled agent tools. Each tool is explicitly defined and validated.
// The model emits structured action fields (never code); the server maps
// them to these executors. The model can never touch the DOM or navigate
// to arbitrary URLs.

import { serverConfig } from "./config";
import { retrieveKnowledge, listByCategory, getByRefId } from "./knowledge";
import { applyProjectBriefUpdate } from "./briefLifecycle";
import { toKnowledgeCard } from "./storage";
import type { KnowledgeCard, ProjectBrief, ProjectBriefEdits } from "../../lib/fartak/types";

// Approved navigation targets — the real sections of the host website.
export const NAV_TARGETS = serverConfig.navTargets;

function asString(v: unknown, max = 1000): string {
  if (v == null) return "";
  return String(v).slice(0, max);
}

function asStringArray(v: unknown, max = 12): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => asString(x, 200)).filter(Boolean).slice(0, max);
}

export type SearchResult = { type: "context"; text: string; items?: KnowledgeCard[] };
export type NavigateResult = { type: "action"; action: { type: "navigate_to"; target: string } } | null;
export type ShowResult =
  | { type: "context"; text: string }
  | { type: "action"; action: { type: "show_project"; project: KnowledgeCard } | { type: "show_service"; service: KnowledgeCard } };

export async function searchCompany(query: unknown): Promise<SearchResult> {
  const text = await retrieveKnowledge(asString(query, 200), 5);
  return { type: "context", text: text || "No company information found." };
}

export async function searchProjects(query: unknown): Promise<SearchResult> {
  const projects = await listByCategory("projects", 10);
  const q = asString(query, 200).toLowerCase();
  const filtered = q
    ? projects.filter((p) => `${p.title} ${p.content}`.toLowerCase().includes(q))
    : projects;
  const text = filtered.length
    ? filtered
        .map((p) => `- ${p.title} (id: ${p.refId || p.id})${p.isPlaceholder ? " [placeholder]" : ""}`)
        .join("\n")
    : "No projects available yet.";
  return { type: "context", text, items: filtered.map(toKnowledgeCard) };
}

export async function searchServices(query: unknown): Promise<SearchResult> {
  const services = await listByCategory("services", 10);
  const q = asString(query, 200).toLowerCase();
  const filtered = q
    ? services.filter((s) => `${s.title} ${s.content}`.toLowerCase().includes(q))
    : services;
  const text = filtered.length
    ? filtered
        .map((s) => `- ${s.title} (id: ${s.refId || s.id})${s.isPlaceholder ? " [placeholder]" : ""}`)
        .join("\n")
    : "No services available yet.";
  return { type: "context", text, items: filtered.map(toKnowledgeCard) };
}

export async function showProject(id: unknown): Promise<ShowResult> {
  const ref = asString(id, 100);
  if (!ref) return { type: "context", text: "Project not found." };
  const project = await getByRefId(ref);
  if (!project || project.category !== "projects") {
    return { type: "context", text: "Project not found." };
  }
  return { type: "action", action: { type: "show_project", project: toKnowledgeCard(project) } };
}

export async function showService(id: unknown): Promise<ShowResult> {
  const ref = asString(id, 100);
  if (!ref) return { type: "context", text: "Service not found." };
  const service = await getByRefId(ref);
  if (!service || service.category !== "services") {
    return { type: "context", text: "Service not found." };
  }
  return { type: "action", action: { type: "show_service", service: toKnowledgeCard(service) } };
}

export async function createProjectBrief(
  data: Record<string, unknown>,
  conversationId: string
): Promise<{ brief: ProjectBrief }> {
  const edits: ProjectBriefEdits = {
    project_name: asString(data.project_name, 200),
    project_type: asString(data.project_type, 200),
    problem: asString(data.problem, 1000),
    goal: asString(data.goal, 1000),
    target_users: asString(data.target_users, 1000),
    user_roles: asString(data.user_roles, 500),
    platform: asString(data.platform, 200),
    features: asStringArray(data.features),
    workflows: asString(data.workflows, 1000),
    ai_requirements: asString(data.ai_requirements, 1000),
    integrations: asString(data.integrations, 1000),
    constraints: asString(data.constraints, 1000),
    mvp_scope: asString(data.mvp_scope, 1000),
    future_scope: asString(data.future_scope, 1000),
    assumptions: asStringArray(data.assumptions),
    open_questions: asStringArray(data.open_questions),
    timeline: asString(data.timeline, 200),
    budget: asString(data.budget, 200),
    geographic_scope: asString(data.geographic_scope, 300),
    languages: asString(data.languages, 300),
    security_privacy: asString(data.security_privacy, 1000),
    additional_notes: asString(data.additional_notes, 1000),
  };
  // The AI may only propose CONTENT. The lifecycle module creates the first
  // brief atomically or updates the existing authoritative one — status,
  // readiness, confirmedAt and lock state are never the model's decision.
  const brief = await applyProjectBriefUpdate({ conversationId, edits });
  return { brief };
}

export function navigateTo(target: unknown): NavigateResult {
  const t = asString(target, 100);
  if (!NAV_TARGETS.includes(t)) return null;
  return { type: "action", action: { type: "navigate_to", target: t } };
}

// A brief is meaningful when the model actually captured something.
export function briefIsMeaningful(brief: unknown): boolean {
  if (!brief || typeof brief !== "object") return false;
  const b = brief as Record<string, unknown>;
  return !!asString(b.project_name) || !!asString(b.project_type) || !!asString(b.problem);
}
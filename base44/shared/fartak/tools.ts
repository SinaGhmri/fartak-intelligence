// Controlled agent tools. Each tool is explicitly defined and validated.
// The model emits structured action fields (not arbitrary code); the backend
// maps them to these executors. The model can never touch the DOM or navigate
// to arbitrary URLs.

import { retrieveKnowledge, listByCategory, getByRefId } from "./knowledge.ts";

// Real section ids of the Puyesh Fartak Sina website.
export const NAV_TARGETS = ["home", "about", "services", "projects", "process", "contact"];

function asString(v, max = 1000) {
  if (v == null) return "";
  return String(v).slice(0, max);
}

function asStringArray(v, max = 12) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => asString(x, 200)).filter(Boolean).slice(0, max);
}

function entryToCard(e) {
  return {
    id: e.id,
    ref_id: e.ref_id || e.id,
    title: e.title,
    category: e.category,
    content: e.content,
    is_placeholder: !!e.is_placeholder,
    tags: e.tags || [],
  };
}

export async function searchCompany(base44, query) {
  const text = await retrieveKnowledge(base44, asString(query, 200), 5);
  return { type: "context", text: text || "No company information found." };
}

export async function searchProjects(base44, query) {
  const projects = await listByCategory(base44, "projects", 10);
  const q = asString(query, 200).toLowerCase();
  const filtered = q
    ? projects.filter((p) => ((p.title || "") + " " + (p.content || "")).toLowerCase().includes(q))
    : projects;
  const text = filtered.length
    ? filtered.map((p) => `- ${p.title} (id: ${p.ref_id || p.id})${p.is_placeholder ? " [placeholder]" : ""}`).join("\n")
    : "No projects available yet.";
  return { type: "context", text, projects: filtered.map(entryToCard) };
}

export async function searchServices(base44, query) {
  const services = await listByCategory(base44, "services", 10);
  const q = asString(query, 200).toLowerCase();
  const filtered = q
    ? services.filter((s) => ((s.title || "") + " " + (s.content || "")).toLowerCase().includes(q))
    : services;
  const text = filtered.length
    ? services.map((s) => `- ${s.title} (id: ${s.ref_id || s.id})${s.is_placeholder ? " [placeholder]" : ""}`).join("\n")
    : "No services available yet.";
  return { type: "context", text, services: filtered.map(entryToCard) };
}

export async function showProject(base44, id) {
  const ref = asString(id, 100);
  if (!ref) return { type: "context", text: "Project not found." };
  const project =
    (await getByRefId(base44, ref)) ||
    (await base44.asServiceRole.entities.KnowledgeEntry.get(ref).catch(() => null));
  if (!project || project.category !== "projects") {
    return { type: "context", text: "Project not found." };
  }
  return { type: "action", action: { type: "show_project", project: entryToCard(project) } };
}

export async function showService(base44, id) {
  const ref = asString(id, 100);
  if (!ref) return { type: "context", text: "Service not found." };
  const service =
    (await getByRefId(base44, ref)) ||
    (await base44.asServiceRole.entities.KnowledgeEntry.get(ref).catch(() => null));
  if (!service || service.category !== "services") {
    return { type: "context", text: "Service not found." };
  }
  return { type: "action", action: { type: "show_service", service: entryToCard(service) } };
}

export async function createBrief(base44, data, conversationId) {
  const brief = await base44.asServiceRole.entities.ProjectBrief.create({
    conversation_id: conversationId,
    project_name: asString(data.project_name, 120) || "Untitled project",
    problem: asString(data.problem, 1000),
    goal: asString(data.goal, 1000),
    target_users: asString(data.target_users, 1000),
    user_roles: asString(data.user_roles, 500),
    platform: asString(data.platform, 200),
    features: asStringArray(data.features),
    workflows: asString(data.workflows, 1000),
    ai_requirements: asString(data.ai_requirements, 1000),
    integrations: asString(data.integrations, 1000),
    stage: asString(data.stage, 120),
    mvp_scope: asString(data.mvp_scope, 1000),
    future_scope: asString(data.future_scope, 1000),
    assumptions: asStringArray(data.assumptions),
    open_questions: asStringArray(data.open_questions),
    timeline: asString(data.timeline, 120),
    notes: asString(data.notes, 1000),
    status: "draft",
  });
  await base44.asServiceRole.entities.Conversation.update(conversationId, { brief_id: brief.id }).catch(() => {});
  return { type: "action", action: { type: "project_brief", brief }, brief };
}

export function navigateTo(target) {
  if (!NAV_TARGETS.includes(target)) return null;
  return { type: "action", action: { type: "navigate_to", target } };
}
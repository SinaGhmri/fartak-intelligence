// Data access layer (Prisma). The rest of the server code only uses these
// functions — swapping the database means rewriting this one file.

import { PrismaClient } from "@prisma/client";
import type {
  KnowledgeCard,
  ProjectBrief,
  ProjectBriefEdits,
  ReadinessState,
} from "../../lib/fartak/types";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// ── Conversations ──────────────────────────────────────────────────────────

export async function getConversation(id: string) {
  return prisma.conversation.findUnique({ where: { id } });
}

export async function createConversation(data: { intent?: string; title: string }) {
  return prisma.conversation.create({
    data: { status: "active", intent: data.intent || "", title: data.title.slice(0, 60) },
  });
}

export async function updateConversation(
  id: string,
  data: { status?: string; briefId?: string; leadId?: string; summary?: string }
) {
  return prisma.conversation.update({ where: { id }, data }).catch(() => null);
}

export async function incrementMessageCount(id: string, delta: number) {
  return prisma.conversation
    .update({ where: { id }, data: { messageCount: { increment: delta } } })
    .catch(() => null);
}

// ── Messages ───────────────────────────────────────────────────────────────

export interface CreateMessageData {
  conversationId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: string;
  cards?: string;
}

export async function createMessage(data: CreateMessageData) {
  return prisma.message.create({ data: { ...data } });
}

export async function listMessages(conversationId: string, limit: number) {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.reverse(); // ascending for the agent's transcript
}

// ── Knowledge Base ─────────────────────────────────────────────────────────

export async function listKnowledge(limit = 100) {
  return prisma.knowledgeEntry.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

export async function listKnowledgeByCategory(category: string, limit = 10) {
  return prisma.knowledgeEntry.findMany({
    where: { category },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getKnowledgeByRefId(refId: string) {
  return prisma.knowledgeEntry.findFirst({ where: { refId }, orderBy: { createdAt: "desc" } });
}

export function toKnowledgeCard(e: {
  id: string;
  refId: string | null;
  title: string;
  category: string;
  content: string;
  isPlaceholder: boolean;
  tags: string[];
}): KnowledgeCard {
  return {
    id: e.id,
    ref_id: e.refId || e.id,
    title: e.title,
    category: e.category,
    content: e.content,
    is_placeholder: e.isPlaceholder,
    tags: e.tags || [],
  };
}

// ── Project briefs ─────────────────────────────────────────────────────────

export async function createBrief(
  conversationId: string,
  brief: ProjectBriefEdits,
  readiness?: ReadinessState | null
) {
  const record = await prisma.projectBrief.create({
    data: {
      conversationId,
      projectName: brief.project_name || null,
      projectType: brief.project_type || null,
      problem: brief.problem || null,
      goal: brief.goal || null,
      targetUsers: brief.target_users || null,
      userRoles: brief.user_roles || null,
      platform: brief.platform || null,
      features: brief.features || [],
      workflows: brief.workflows || null,
      aiRequirements: brief.ai_requirements || null,
      integrations: brief.integrations || null,
      constraints: brief.constraints || null,
      mvpScope: brief.mvp_scope || null,
      futureScope: brief.future_scope || null,
      assumptions: brief.assumptions || [],
      openQuestions: brief.open_questions || [],
      timeline: brief.timeline || null,
      budget: brief.budget || null,
      geographicScope: brief.geographic_scope || null,
      languages: brief.languages || null,
      securityPrivacy: brief.security_privacy || null,
      additionalNotes: brief.additional_notes || null,
      readiness: readiness ? JSON.stringify(readiness) : null,
      status: "draft",
    },
  });
  await updateConversation(conversationId, { briefId: record.id });
  return toWireBrief(record);
}

export async function updateBrief(id: string, edits: ProjectBriefEdits, confirmed = false) {
  const record = await prisma.projectBrief
    .update({
      where: { id },
      // Inline conditional spreads keep the object assignable to Prisma's
      // generated update-input type; omitted keys are simply not updated.
      data: {
        ...(edits.project_name !== undefined && { projectName: edits.project_name }),
        ...(edits.project_type !== undefined && { projectType: edits.project_type }),
        ...(edits.problem !== undefined && { problem: edits.problem }),
        ...(edits.goal !== undefined && { goal: edits.goal }),
        ...(edits.target_users !== undefined && { targetUsers: edits.target_users }),
        ...(edits.user_roles !== undefined && { userRoles: edits.user_roles }),
        ...(edits.platform !== undefined && { platform: edits.platform }),
        ...(edits.features !== undefined && { features: edits.features }),
        ...(edits.workflows !== undefined && { workflows: edits.workflows }),
        ...(edits.ai_requirements !== undefined && { aiRequirements: edits.ai_requirements }),
        ...(edits.integrations !== undefined && { integrations: edits.integrations }),
        ...(edits.constraints !== undefined && { constraints: edits.constraints }),
        ...(edits.mvp_scope !== undefined && { mvpScope: edits.mvp_scope }),
        ...(edits.future_scope !== undefined && { futureScope: edits.future_scope }),
        ...(edits.assumptions !== undefined && { assumptions: edits.assumptions }),
        ...(edits.open_questions !== undefined && { openQuestions: edits.open_questions }),
        ...(edits.timeline !== undefined && { timeline: edits.timeline }),
        ...(edits.budget !== undefined && { budget: edits.budget }),
        ...(edits.geographic_scope !== undefined && { geographicScope: edits.geographic_scope }),
        ...(edits.languages !== undefined && { languages: edits.languages }),
        ...(edits.security_privacy !== undefined && { securityPrivacy: edits.security_privacy }),
        ...(edits.additional_notes !== undefined && { additionalNotes: edits.additional_notes }),
        ...(confirmed && { status: "confirmed", confirmedAt: new Date() }),
      },
    })
    .catch(() => null);
  return record ? toWireBrief(record) : null;
}

type BriefRecord = {
  id: string;
  conversationId: string;
  projectName: string | null;
  projectType: string | null;
  problem: string | null;
  goal: string | null;
  targetUsers: string | null;
  userRoles: string | null;
  platform: string | null;
  features: string[];
  workflows: string | null;
  aiRequirements: string | null;
  integrations: string | null;
  constraints: string | null;
  mvpScope: string | null;
  futureScope: string | null;
  assumptions: string[];
  openQuestions: string[];
  timeline: string | null;
  budget: string | null;
  geographicScope: string | null;
  languages: string | null;
  securityPrivacy: string | null;
  additionalNotes: string | null;
  readiness: string | null;
  status: string;
};

export function toWireBrief(b: BriefRecord): ProjectBrief {
  return {
    id: b.id,
    conversation_id: b.conversationId,
    project_name: b.projectName || undefined,
    project_type: b.projectType || undefined,
    problem: b.problem || undefined,
    goal: b.goal || undefined,
    target_users: b.targetUsers || undefined,
    user_roles: b.userRoles || undefined,
    platform: b.platform || undefined,
    features: b.features || [],
    workflows: b.workflows || undefined,
    ai_requirements: b.aiRequirements || undefined,
    integrations: b.integrations || undefined,
    constraints: b.constraints || undefined,
    mvp_scope: b.mvpScope || undefined,
    future_scope: b.futureScope || undefined,
    assumptions: b.assumptions || [],
    open_questions: b.openQuestions || [],
    timeline: b.timeline || undefined,
    budget: b.budget || undefined,
    geographic_scope: b.geographicScope || undefined,
    languages: b.languages || undefined,
    security_privacy: b.securityPrivacy || undefined,
    additional_notes: b.additionalNotes || undefined,
    readiness: parseReadiness(b.readiness),
    status: b.status === "confirmed" ? "confirmed" : "draft",
  };
}

function parseReadiness(json: string | null): ReadinessState | undefined {
  if (!json) return undefined;
  try {
    const r = JSON.parse(json) as Record<string, unknown>;
    return {
      ready: !!r.ready,
      missingCritical: Array.isArray(r.missingCritical) ? r.missingCritical.map(String) : [],
      missingOptional: Array.isArray(r.missingOptional) ? r.missingOptional.map(String) : [],
    };
  } catch {
    return undefined;
  }
}

export async function getBrief(id: string) {
  const record = await prisma.projectBrief.findUnique({ where: { id } }).catch(() => null);
  return record ? toWireBrief(record) : null;
}

// ── Leads ──────────────────────────────────────────────────────────────────

// Human-readable project reference, e.g. FTK-2048. Generated server-side
// at handoff and unique across all leads.
export async function generateProjectReference(prefix = "FTK"): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const ref = `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
    const existing = await prisma.lead
      .findUnique({ where: { projectReference: ref } })
      .catch(() => null);
    if (!existing) return ref;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

export async function createLead(data: {
  conversationId: string;
  projectBriefId?: string | null;
  projectReference: string;
  name: string;
  phone: string;
  email?: string | null;
  preferredContactMethod: string;
}) {
  return prisma.lead.create({
    data: {
      conversationId: data.conversationId,
      projectBriefId: data.projectBriefId || null,
      projectReference: data.projectReference,
      name: data.name,
      phone: data.phone,
      email: data.email || null,
      preferredContactMethod: data.preferredContactMethod,
      status: "new",
    },
  });
}

export async function getLead(id: string) {
  return prisma.lead.findUnique({ where: { id } }).catch(() => null);
}
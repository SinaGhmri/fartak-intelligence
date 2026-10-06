// Data access layer (Prisma). The rest of the server code only uses these
// functions — swapping the database means rewriting this one file.

import { randomInt } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  isBriefStatus,
  type BriefStatus,
  type KnowledgeCard,
  type ProjectBrief,
  type ProjectBriefEdits,
  type ReadinessState,
} from "../../lib/fartak/types";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Plain client or an open transaction — brief lifecycle helpers accept both
// so multi-record operations can run atomically.
export type Db = PrismaClient | Prisma.TransactionClient;

// ── Conversations ──────────────────────────────────────────────────────────

export async function getConversation(id: string) {
  return prisma.conversation.findUnique({ where: { id } });
}

export async function createConversation(data: {
  intent?: string;
  title: string;
  ownerTokenHash: string;
}) {
  return prisma.conversation.create({
    data: {
      status: "active",
      intent: data.intent || "",
      title: data.title.slice(0, 60),
      ownerTokenHash: data.ownerTokenHash,
    },
  });
}

// Ownership check: an id alone is never proof of ownership — the conversation
// must carry the SHA-256 hash of the caller's anonymous session cookie.
// Unknown ids and foreign conversations are indistinguishable to the caller
// (both return null → the route replies with the same generic error).
export async function getConversationForOwner(id: string, ownerTokenHash: string) {
  if (!id || !ownerTokenHash) return null;
  const conversation = await prisma.conversation.findUnique({ where: { id } }).catch(() => null);
  if (!conversation) return null;
  if (conversation.ownerTokenHash === ownerTokenHash) return conversation;
  if (conversation.ownerTokenHash) return null; // owned by a different session
  // Migration path only: rows created before ownership tracking have no hash.
  // Claim atomically — the first session to present the id adopts it, every
  // other session is rejected. Conversations created after this phase always
  // get a hash at creation, so this branch never applies to new data.
  const claimed = await prisma.conversation
    .updateMany({ where: { id, ownerTokenHash: null }, data: { ownerTokenHash } })
    .catch(() => null);
  return claimed && claimed.count === 1 ? { ...conversation, ownerTokenHash } : null;
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

// ── Project briefs ──────────────────────────────────────────────────────────
// Storage only stores/reads brief rows here. Lifecycle rules (state
// transitions, readiness, reconciliation) live in briefLifecycle.ts — the
// single authority applied by every update path.

/** Plain column values for brief content (assignable to both Prisma create
 * and update inputs — no update-ops wrapper types). */
export interface BriefContentData {
  projectName?: string | null;
  projectType?: string | null;
  problem?: string | null;
  goal?: string | null;
  targetUsers?: string | null;
  userRoles?: string | null;
  platform?: string | null;
  features?: string[];
  workflows?: string | null;
  aiRequirements?: string | null;
  integrations?: string | null;
  constraints?: string | null;
  mvpScope?: string | null;
  futureScope?: string | null;
  assumptions?: string[];
  openQuestions?: string[];
  timeline?: string | null;
  budget?: string | null;
  geographicScope?: string | null;
  languages?: string | null;
  securityPrivacy?: string | null;
  additionalNotes?: string | null;
}

/** Map sanitized editable fields to their Prisma column names (omitted keys
 * are simply not written). Server-owned columns are never represented. */
export function toBriefRowData(edits: ProjectBriefEdits): BriefContentData {
  return {
    ...(edits.project_name !== undefined && { projectName: edits.project_name || null }),
    ...(edits.project_type !== undefined && { projectType: edits.project_type || null }),
    ...(edits.problem !== undefined && { problem: edits.problem || null }),
    ...(edits.goal !== undefined && { goal: edits.goal || null }),
    ...(edits.target_users !== undefined && { targetUsers: edits.target_users || null }),
    ...(edits.user_roles !== undefined && { userRoles: edits.user_roles || null }),
    ...(edits.platform !== undefined && { platform: edits.platform || null }),
    ...(edits.features !== undefined && { features: edits.features }),
    ...(edits.workflows !== undefined && { workflows: edits.workflows || null }),
    ...(edits.ai_requirements !== undefined && { aiRequirements: edits.ai_requirements || null }),
    ...(edits.integrations !== undefined && { integrations: edits.integrations || null }),
    ...(edits.constraints !== undefined && { constraints: edits.constraints || null }),
    ...(edits.mvp_scope !== undefined && { mvpScope: edits.mvp_scope || null }),
    ...(edits.future_scope !== undefined && { futureScope: edits.future_scope || null }),
    ...(edits.assumptions !== undefined && { assumptions: edits.assumptions }),
    ...(edits.open_questions !== undefined && { openQuestions: edits.open_questions }),
    ...(edits.timeline !== undefined && { timeline: edits.timeline || null }),
    ...(edits.budget !== undefined && { budget: edits.budget || null }),
    ...(edits.geographic_scope !== undefined && { geographicScope: edits.geographic_scope || null }),
    ...(edits.languages !== undefined && { languages: edits.languages || null }),
    ...(edits.security_privacy !== undefined && { securityPrivacy: edits.security_privacy || null }),
    ...(edits.additional_notes !== undefined && { additionalNotes: edits.additional_notes || null }),
  };
}

export async function getBriefRecord(id: string, db: Db = prisma): Promise<BriefRecord | null> {
  if (!id) return null;
  return db.projectBrief.findUnique({ where: { id } });
}

export async function findBriefRecordByConversation(
  conversationId: string,
  db: Db = prisma
): Promise<BriefRecord | null> {
  if (!conversationId) return null;
  return db.projectBrief.findFirst({ where: { conversationId }, orderBy: { createdAt: "asc" } });
}

/** Insert the first brief of a conversation (caller runs this inside a
 * transaction together with the Conversation.briefId pointer assignment). */
export async function insertBriefRow(
  data: { conversationId: string; edits: ProjectBriefEdits; status: BriefStatus; readiness: string | null },
  db: Db = prisma
): Promise<BriefRecord> {
  return db.projectBrief.create({
    data: {
      ...toBriefRowData(data.edits),
      conversationId: data.conversationId,
      status: data.status,
      confirmedAt: null,
      readiness: data.readiness,
    },
  });
}

/**
 * Optimistically-conditional update: when `updatedAt` is provided, the write
 * only applies if the row was not modified since it was read (concurrency
 * control). Returns the number of rows actually updated (0 = stale/locked).
 */
export async function updateBriefRow(
  where: { id: string; updatedAt?: Date },
  data: Prisma.ProjectBriefUpdateManyMutationInput,
  db: Db = prisma
): Promise<number> {
  const res = await db.projectBrief.updateMany({
    where: { id: where.id, ...(where.updatedAt ? { updatedAt: where.updatedAt } : {}) },
    data,
  });
  return res.count;
}

export type BriefRecord = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
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
  confirmedAt: Date | null;
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
    status: isBriefStatus(b.status) ? b.status : "draft",
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
// at handoff; the client can never choose it. Randomness comes from Node's
// CSPRNG, but the @unique constraint on projectReference remains the final
// authority — callers retry on collision.
export async function generateProjectReference(prefix = "FTK"): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const ref = `${prefix}-${1000 + randomInt(9000)}`;
    const existing = await prisma.lead
      .findUnique({ where: { projectReference: ref } })
      .catch(() => null);
    if (!existing) return ref;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

// Earliest lead for a conversation (the canonical one under the @unique
// constraint). findFirst keeps this working even before the unique index
// exists and avoids leaking anything through error codes.
export async function findLeadByConversation(conversationId: string) {
  if (!conversationId) return null;
  return prisma.lead
    .findFirst({ where: { conversationId }, orderBy: { createdAt: "asc" } })
    .catch(() => null);
}

// Lead CREATION lives in briefLifecycle.finalizeHandoff() so that the Lead
// row, the brief LOCK, and the conversation completion commit atomically.

export async function getLead(id: string) {
  return prisma.lead.findUnique({ where: { id } }).catch(() => null);
}
// Project Brief lifecycle — the single server-side authority for brief state.
//
// Invariants (Phase 2):
//   • ONE authoritative brief per conversation (ProjectBrief.conversationId
//     is @unique; Conversation.briefId points at it and is set atomically).
//   • Lifecycle: draft → review → confirmed → locked. Only this module
//     transitions state; API routes and AI tools call into it.
//   • confirmedAt exists ⇔ status = confirmed; editing a confirmed brief
//     invalidates the confirmation (confirmed → review/draft).
//   • After a successful handoff the brief is locked and immutable.
//
// Session/ownership verification lives in the API routes (Phase 1). This
// module owns state transitions, readiness, collection reconciliation and
// atomicity. Client payloads are sanitized before reaching here; server-
// owned fields (status/confirmedAt/conversation/id/readiness) are never
// taken from input.

import { Prisma } from "@prisma/client";
import {
  prisma,
  getConversation,
  getBriefRecord,
  findBriefRecordByConversation,
  insertBriefRow,
  updateBriefRow,
  toBriefRowData,
  toWireBrief,
  updateConversation,
  type BriefRecord,
} from "./storage";
import { ApiError, sanitizeBriefEdits, type ValidatedContact } from "./validation";
import {
  BRIEF_STATUS,
  isBriefStatus,
  type BriefStatus,
  type ProjectBrief,
  type ProjectBriefEdits,
  type ReadinessState,
} from "../../lib/fartak/types";

function isUniqueViolation(error: unknown): boolean {
  return !!(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}
export { isUniqueViolation };

function normalizeStatus(value: string): BriefStatus {
  return isBriefStatus(value) ? value : BRIEF_STATUS.DRAFT;
}

// ── Readiness (deterministic, server-computed) ──────────────────────────────
// Readiness answers: "does this brief carry enough MEANINGFUL information
// for a review/handoff?" Critical = the project's identity/problem/outcome/
// core functionality. Optional fields (budget, timeline, platform, …) are
// reported as missing but NEVER block confirmation — no artificial friction.

export function evaluateBriefReadiness(b: Partial<ProjectBrief>): ReadinessState {
  const hasText = (v?: string) => !!(v && v.trim());
  const missingCritical: string[] = [];
  const missingOptional: string[] = [];

  if (!hasText(b.project_name) && !hasText(b.project_type) && !hasText(b.problem)) {
    missingCritical.push("Project idea / concept");
  }
  if (!hasText(b.problem)) missingCritical.push("Problem to solve");
  if (!hasText(b.goal)) missingCritical.push("Desired outcome / solution");
  if (!(b.features && b.features.some((f) => f && f.trim()))) {
    missingCritical.push("Core features / functionality");
  }

  if (!hasText(b.project_name)) missingOptional.push("Project name");
  if (!hasText(b.target_users)) missingOptional.push("Target users");
  if (!hasText(b.platform)) missingOptional.push("Platform");
  if (!hasText(b.timeline)) missingOptional.push("Timeline");
  if (!hasText(b.budget)) missingOptional.push("Budget");

  return { ready: missingCritical.length === 0, missingCritical, missingOptional };
}

export function isBriefReady(b: Partial<ProjectBrief>): boolean {
  return evaluateBriefReadiness(b).ready;
}

// ── Content helpers ─────────────────────────────────────────────────────────

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const aa = Array.isArray(a) ? a : [];
    const bb = Array.isArray(b) ? b : [];
    return aa.length === bb.length && aa.every((x, i) => x === bb[i]);
  }
  return (a ?? "") === (b ?? "");
}

function isEmptyContent(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 0;
  return !(v && String(v).trim());
}

/** Merge sanitized edits over the stored brief (edits win per present key). */
function mergeContent(base: ProjectBrief, clean: ProjectBriefEdits): ProjectBrief {
  const next: ProjectBrief = { ...base };
  const target = next as unknown as Record<string, unknown>;
  for (const key of Object.keys(clean) as (keyof ProjectBriefEdits)[]) {
    target[key] = clean[key];
  }
  return next;
}

/** Keys whose sanitized value actually differs from the stored content. */
function dirtyKeys(base: ProjectBrief, clean: ProjectBriefEdits): (keyof ProjectBriefEdits)[] {
  return (Object.keys(clean) as (keyof ProjectBriefEdits)[]).filter(
    (k) => !sameValue(clean[k], base[k])
  );
}

// ── Assumptions / open-questions reconciliation ─────────────────────────────
// First-class lifecycle data: the same information may not live in two
// collections at once. When a structured field becomes known/changes, list
// items about that topic are obsolete — the answer now lives in the field.

const FIELD_KEYWORDS: Partial<Record<keyof ProjectBriefEdits, string[]>> = {
  timeline: ["timeline", "deadline", "schedule", "how long", "delivery date"],
  budget: ["budget", "cost", "pricing", "price"],
  platform: ["platform", "ios", "android", "mobile", "desktop"],
  target_users: ["target user", "end user", "who will use"],
  languages: ["language"],
  geographic_scope: ["geographic", "region", "country", "location"],
  integrations: ["integration", "third party", "third-party"],
  security_privacy: ["security", "privacy", "gdpr"],
  mvp_scope: ["mvp", "minimum viable"],
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeByNorm(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = raw.trim();
    if (!item) continue;
    const key = norm(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function reconcileCollections(prev: ProjectBrief, next: ProjectBrief): {
  assumptions: string[];
  openQuestions: string[];
} {
  // Fields whose value became known or changed in this update.
  const changedKnownFields = (Object.keys(FIELD_KEYWORDS) as (keyof ProjectBriefEdits)[]).filter(
    (k) => !sameValue(prev[k], next[k]) && !isEmptyContent(next[k])
  );

  const obsolete = (item: string): boolean => {
    const n = norm(item);
    if (!n) return true;
    for (const k of changedKnownFields) {
      for (const kw of FIELD_KEYWORDS[k] ?? []) {
        if (n.includes(kw)) return true; // answered — the field now holds it
      }
    }
    return false;
  };

  let assumptions = dedupeByNorm((next.assumptions ?? []).filter((a) => !obsolete(a)));
  let openQuestions = dedupeByNorm((next.open_questions ?? []).filter((q) => !obsolete(q)));

  // Cross-collection coherence: an item equal to a confirmed feature is not
  // an assumption; a question already captured as an assumption is not open.
  const featureNorms = new Set((next.features ?? []).map(norm).filter(Boolean));
  assumptions = assumptions.filter((a) => !featureNorms.has(norm(a)));
  const assumptionNorms = new Set(assumptions.map(norm));
  openQuestions = openQuestions.filter(
    (q) => !featureNorms.has(norm(q)) && !assumptionNorms.has(norm(q))
  );

  return { assumptions, openQuestions };
}

// ── Authoritative brief resolution (invariant A) ────────────────────────────

async function resolveAuthoritativeBrief(
  conversationId: string,
  pointerId: string | null
): Promise<BriefRecord | null> {
  if (pointerId) {
    const row = await getBriefRecord(pointerId);
    if (row && row.conversationId === conversationId) return row;
  }
  const row = await findBriefRecordByConversation(conversationId);
  // Self-heal: the pointer must reference the conversation's brief.
  if (row && pointerId !== row.id) {
    await updateConversation(conversationId, { briefId: row.id });
  }
  return row;
}

// ── State computation (the transition table, in one place) ──────────────────

type BriefWrite = Prisma.ProjectBriefUpdateManyMutationInput & { updatedAt: Date };

function computeNextState(
  brief: BriefRecord,
  base: ProjectBrief,
  clean: ProjectBriefEdits
): { writeData: BriefWrite | null } {
  const dirty = dirtyKeys(base, clean);
  const merged = mergeContent(base, clean);
  const { assumptions, openQuestions } = reconcileCollections(base, merged);
  const reconciledChanged =
    !sameValue(assumptions, base.assumptions ?? []) ||
    !sameValue(openQuestions, base.open_questions ?? []);

  const readiness = evaluateBriefReadiness({ ...merged, assumptions, open_questions: openQuestions });
  const status = normalizeStatus(brief.status);
  const contentChanged = dirty.length > 0;

  // Server-controlled transitions (§6):
  //   confirmed + content changed → invalidation → review (still ready) or draft
  //   draft / review             → review once ready, otherwise draft
  //   locked                     → rejected before we get here
  const nextStatus: BriefStatus =
    status === BRIEF_STATUS.CONFIRMED
      ? contentChanged
        ? readiness.ready
          ? BRIEF_STATUS.REVIEW
          : BRIEF_STATUS.DRAFT
        : BRIEF_STATUS.CONFIRMED
      : readiness.ready
        ? BRIEF_STATUS.REVIEW
        : BRIEF_STATUS.DRAFT;

  const readinessJson = JSON.stringify(readiness);
  const readinessChanged = brief.readiness !== readinessJson;
  const statusChanged = nextStatus !== status;

  // No effective change → no write: repeated identical updates are no-ops
  // and an unchanged confirmed brief keeps its confirmation (idempotency).
  if (!contentChanged && !reconciledChanged && !statusChanged && !readinessChanged) {
    return { writeData: null };
  }

  const dirtyEdits: ProjectBriefEdits = {};
  for (const k of dirty) (dirtyEdits as Record<string, unknown>)[k] = clean[k];

  return {
    writeData: {
      ...toBriefRowData(dirtyEdits),
      assumptions,
      openQuestions,
      readiness: readinessJson,
      status: nextStatus,
      // Every content write leaves a non-confirmed brief WITHOUT a timestamp
      // (invariant G); an invalidated confirmation clears confirmedAt (§8).
      confirmedAt: null,
      updatedAt: new Date(),
    },
  };
}

// ── The single update path ──────────────────────────────────────────────────

/**
 * Apply a Project Brief update for a conversation — used by the AI tool
 * (discovery extractions), user edits, and the confirmation flow. Rules
 * (callers must verify session → conversation ownership FIRST — this
 * function treats the conversationId as already-authorized):
 *   1. sanitize (allow-list + caps — server-owned fields dropped)
 *   2. resolve the authoritative brief (creating the FIRST one atomically
 *      together with the Conversation.briefId pointer if none exists)
 *   3. reject locked briefs (409)
 *   4. reject content writes on completed conversations (409) — only
 *      idempotent no-op retries may pass through (invariant D)
 *   5. reconcile assumptions/open questions, recalculate readiness
 *   6. apply the state transition, guarded against concurrent writers
 *   7. return the authoritative stored brief
 */
export async function applyProjectBriefUpdate(params: {
  conversationId: string;
  edits: unknown;
}): Promise<ProjectBrief> {
  const clean = sanitizeBriefEdits(params.edits);

  for (let attempt = 0; attempt < 3; attempt++) {
    const conversation = await getConversation(params.conversationId);
    if (!conversation) throw new ApiError(404, "Conversation not found");
    // Invariant D preparation: a completed (handed-off) conversation accepts
    // no content writes — only idempotent no-op updates may pass through.
    const conversationCompleted = conversation.status === "completed";

    const brief = await resolveAuthoritativeBrief(params.conversationId, conversation.briefId);

    if (!brief) {
      // First brief of this conversation: insert + pointer in ONE transaction.
      // ProjectBrief.conversationId @unique arbitrates creation races — the
      // loser hits P2002, rolls back, and retries into the update path.
      const readiness = evaluateBriefReadiness(clean);
      try {
        return await prisma.$transaction(async (tx) => {
          const created = await insertBriefRow(
            {
              conversationId: params.conversationId,
              edits: clean,
              status: readiness.ready ? BRIEF_STATUS.REVIEW : BRIEF_STATUS.DRAFT,
              readiness: JSON.stringify(readiness),
            },
            tx
          );
          await tx.conversation.update({
            where: { id: params.conversationId },
            data: { briefId: created.id },
          });
          return toWireBrief(created);
        });
      } catch (error) {
        if (isUniqueViolation(error)) continue; // concurrent creation won — reuse
        throw error;
      }
    }

    const base = toWireBrief(brief);
    if (base.status === BRIEF_STATUS.LOCKED) {
      throw new ApiError(409, "Project brief is locked");
    }

    const { writeData } = computeNextState(brief, base, clean);
    if (!writeData) return base; // idempotent no-op
    // A completed conversation keeps no draft review cycle (invariant D):
    // retries with identical content still succeed, but any real write is
    // a conflict the visitor must not silently win.
    if (conversationCompleted) {
      throw new ApiError(409, "Conversation already completed");
    }

    const count = await updateBriefRow({ id: brief.id, updatedAt: brief.updatedAt }, writeData);
    if (count === 1) {
      const updated = await getBriefRecord(brief.id);
      if (updated) return toWireBrief(updated);
    }
    // Stale read (concurrent write or lock) — re-resolve and retry.
  }
  throw new ApiError(409, "The project brief changed concurrently — please retry");
}

// ── Confirmation (review/draft → confirmed) ─────────────────────────────────

/**
 * Explicit confirmation of the authoritative brief.
 * 1. Pending edits are applied FIRST — content changes on a confirmed brief
 *    invalidate the old confirmation (§8); an unchanged confirmed brief is
 *    an idempotent no-op, so retries with identical edits return as-is.
 * 2. The brief must be genuinely ready (deterministic readiness check) —
 *    an insufficient brief can never be confirmed, whatever the client sends.
 * 3. The transition and confirmedAt are written atomically under an
 *    optimistic guard, so a racing edit can never leave
 *    "confirmed + modified content" behind.
 */
export async function confirmProjectBrief(conversationId: string, edits: unknown): Promise<ProjectBrief> {
  const clean = sanitizeBriefEdits(edits);
  if (Object.keys(clean).length > 0) {
    await applyProjectBriefUpdate({ conversationId, edits: clean });
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const conversation = await getConversation(conversationId);
    if (!conversation) throw new ApiError(404, "Conversation not found");
    const brief = await resolveAuthoritativeBrief(conversationId, conversation.briefId);
    if (!brief) throw new ApiError(404, "Brief not found");

    const status = normalizeStatus(brief.status);
    if (status === BRIEF_STATUS.LOCKED) throw new ApiError(409, "Project brief is locked");
    if (status === BRIEF_STATUS.CONFIRMED) return toWireBrief(brief); // idempotent retry

    const base = toWireBrief(brief);
    const readiness = evaluateBriefReadiness(base);
    if (!readiness.ready) {
      throw new ApiError(409, "Project brief is not ready for confirmation yet");
    }

    const count = await updateBriefRow(
      { id: brief.id, updatedAt: brief.updatedAt },
      {
        status: BRIEF_STATUS.CONFIRMED,
        confirmedAt: new Date(), // server-generated, never client-supplied
        readiness: JSON.stringify(readiness),
        updatedAt: new Date(),
      }
    );
    if (count === 1) {
      const updated = await getBriefRecord(brief.id);
      if (updated) return toWireBrief(updated);
    }
    // count === 0: a concurrent edit/lock invalidated this read — retry.
  }
  throw new ApiError(409, "The project brief changed concurrently — please review and confirm again");
}

// ── Handoff finalization (confirmed → locked + conversation completed) ──────

export interface FinalizeHandoffParams {
  conversationId: string;
  briefId: string;
  projectReference: string;
  contact: ValidatedContact;
  summary: string;
  idempotencyKey: string | null;
}

/**
 * Creates the Lead and applies the terminal lifecycle transition in ONE
 * transaction: brief confirmed → locked, conversation → completed,
 * Lead row inserted. Unique-constraint violations (duplicate handoff,
 * reference collision) propagate to the caller's retry loop — the whole
 * transaction rolls back, so no partial state can ever commit.
 *
 * Invariants enforced here: D (a conversation only completes with its
 * brief confirmed), E (locked ⇒ completed conversation), C (the Lead
 * references the authoritative brief).
 */
export async function finalizeHandoff(p: FinalizeHandoffParams) {
  return prisma.$transaction(async (tx) => {
    const lock = await tx.projectBrief.updateMany({
      where: { id: p.briefId, status: BRIEF_STATUS.CONFIRMED },
      data: { status: BRIEF_STATUS.LOCKED, updatedAt: new Date() },
    });
    if (lock.count === 0) {
      // Another handoff may have locked it already (fall through — the Lead
      // unique constraint arbitrates); anything else means the brief was
      // edited/invalidated concurrently → abort the entire handoff.
      const current = await tx.projectBrief.findUnique({
        where: { id: p.briefId },
        select: { status: true },
      });
      if (!current || normalizeStatus(current.status) !== BRIEF_STATUS.LOCKED) {
        throw new ApiError(409, "The project brief changed — please review and confirm again");
      }
    }

    const lead = await tx.lead.create({
      data: {
        conversationId: p.conversationId,
        idempotencyKey: p.idempotencyKey,
        projectBriefId: p.briefId,
        projectReference: p.projectReference,
        name: p.contact.name,
        phone: p.contact.phone,
        email: p.contact.email,
        preferredContactMethod: p.contact.preferredContactMethod,
        status: "new",
      },
    });

    await tx.conversation.update({
      where: { id: p.conversationId },
      data: { leadId: lead.id, status: "completed", summary: p.summary },
    });

    return lead;
  });
}

// Executable LIFECYCLE test matrix — Phase 2 (Project Brief state machine,
// one authoritative brief per conversation, consistency).
//
// Drives the REAL Next.js route handlers with NextRequest against a real
// local PostgreSQL test database. The LLM is replaced through the module's
// supported extension point (setLLMProvider) with a scripted provider, so
// no external API is called. Run: npm run test:lifecycle
//
// Shared scaffolding (environment defaults, runner, visitors, request
// helpers, scripted LLM) lives in ./harness and is imported FIRST, so the
// environment exists before any module under test is dynamically imported.

import {
  test,
  expect,
  callAs,
  newVisitor,
  ScriptedProvider,
  summarize,
  type Visitor,
} from "./harness";

const chatRoute = await import("../fartak-intelligence/app/api/fartak/chat/route");
const briefRoute = await import("../fartak-intelligence/app/api/fartak/brief/route");
const leadRoute = await import("../fartak-intelligence/app/api/fartak/lead/route");
const { prisma } = await import("../fartak-intelligence/server/fartak/storage");
const { setLLMProvider } = await import("../fartak-intelligence/server/fartak/provider");
const lifecycle = await import("../fartak-intelligence/server/fartak/briefLifecycle");
const { hashSessionToken } = await import("../fartak-intelligence/server/fartak/session");

// ── request helpers for the three routes ────────────────────────────────────

const chat = (v: Visitor | null, body: unknown, options: Parameters<typeof callAs>[3] = {}) =>
  callAs(v, chatRoute.POST, "/api/fartak/chat", { ...options, body });
const confirmBrief = (v: Visitor | null, body: unknown, options: Parameters<typeof callAs>[3] = {}) =>
  callAs(v, briefRoute.POST, "/api/fartak/brief", { ...options, body });
const lead = (v: Visitor | null, body: unknown, options: Parameters<typeof callAs>[3] = {}) =>
  callAs(v, leadRoute.POST, "/api/fartak/lead", { ...options, body });

const llm = new ScriptedProvider();
setLLMProvider(llm);

// ── setup: clean test database (dedicated test DB only) ─────────────────────

await prisma.lead.deleteMany();
await prisma.projectBrief.deleteMany();
await prisma.message.deleteMany();
await prisma.conversation.deleteMany();
await prisma.knowledgeEntry.deleteMany();

// A scripted brief payload that is READY (carries the required meaningful
// fields) but still has gaps the tests can answer later.
const READY_PAYLOAD: Record<string, unknown> = {
  project_name: "Lifecycle Test Project",
  project_type: "web_app",
  problem: "A concrete, meaningful problem to solve.",
  goal: "A working platform solving it.",
  features: ["user accounts", "dashboard", "search"],
  assumptions: ["budget TBD"],
  open_questions: ["Which timeline?"],
};

async function newConversation(v: Visitor, message: string, briefPayload?: Record<string, unknown> | null): Promise<{ conversationId: string; briefId: string }> {
  llm.briefMode = !!briefPayload;
  llm.briefPayload = briefPayload ?? null;
  const res = await chat(v, { message });
  llm.briefMode = false;
  llm.briefPayload = null;
  expect(res.status === 200, `chat failed: ${JSON.stringify(res.json)}`);
  const body = res.json as { conversationId?: string; brief?: { id?: string } | null };
  return { conversationId: String(body.conversationId || ""), briefId: body.brief?.id ? String(body.brief.id) : "" };
}

const CONTACT = { name: "Lifecycle Tester", phone: "+98 912 000 1111", preferredContactMethod: "whatsapp" };

// Test 1 — a fresh conversation starts with NO brief.
await test("L1 — new conversation has no brief", async () => {
  const v = newVisitor();
  const { conversationId } = await newConversation(v, "hello");
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  expect(conv?.briefId === null, `expected null briefId, got ${conv?.briefId}`);
  const rows = await prisma.projectBrief.findMany({ where: { conversationId } });
  expect(rows.length === 0, `expected no brief rows, got ${rows.length}`);
});

// Test 2 — first AI extraction creates exactly one brief, wired to the pointer.
await test("L2 — first brief creation yields one brief + pointer", async () => {
  const v = newVisitor();
  const { conversationId, briefId } = await newConversation(v, "I want a booking platform for clinics.", READY_PAYLOAD);
  expect(!!briefId, "no brief created");
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  expect(conv?.briefId === briefId, `pointer ${conv?.briefId} !== brief ${briefId}`);
  const rows = await prisma.projectBrief.findMany({ where: { conversationId } });
  expect(rows.length === 1, `expected 1 brief row, got ${rows.length}`);
});

// Test 3 — repeated extractions REUSE the same brief (no duplicates).
await test("L3 — repeated brief creation reuses the same brief", async () => {
  const v = newVisitor();
  const { conversationId, briefId } = await newConversation(v, "I want a booking platform for clinics.", READY_PAYLOAD);
  llm.briefMode = true;
  llm.briefPayload = { ...READY_PAYLOAD, features: ["user accounts", "dashboard", "search", "payments"] };
  const again = await chat(v, { message: "Also add payments please.", conversationId });
  llm.briefMode = false;
  llm.briefPayload = null;
  expect(again.status === 200, `chat failed: ${JSON.stringify(again.json)}`);
  const returned = ((again.json as { brief?: { id?: string } | null }).brief)?.id;
  expect(returned === briefId, `expected brief reuse (${briefId}), got ${returned}`);
  const rows = await prisma.projectBrief.findMany({ where: { conversationId } });
  expect(rows.length === 1, `expected still 1 brief row, got ${rows.length}`);
});

// ── lifecycle fixtures & helpers ─────────────────────────────────────────────

const { ApiError } = await import("../fartak-intelligence/server/fartak/validation");
const { applyProjectBriefUpdate, confirmProjectBrief } = lifecycle;

/** Assert that fn throws an ApiError with the expected HTTP status. */
async function expectApiError(fn: () => Promise<unknown>, status: number, label: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    expect(
      error instanceof ApiError && (error as { status: number }).status === status,
      `${label}: expected ApiError ${status}, got ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }
  throw new Error(`${label}: expected ApiError ${status}, nothing was thrown`);
}

// Insufficient content: meaningful (has a name) but NOT ready — missing
// problem/goal/features → must stay draft and must never confirm.
const INSUFFICIENT_PAYLOAD: Record<string, unknown> = { project_name: "Early Sketch" };

// Shared flow fixture: draft → review → confirmed → handoff → locked.
let flow: { v: Visitor; conversationId: string; briefId: string };

// Test L4 — multiple AI updates all target the SAME brief; pointer + ownership invariants.
await test("L4 — multiple AI updates update the same brief (invariants A/B)", async () => {
  const v = newVisitor();
  const { conversationId, briefId } = await newConversation(v, "Build me a CRM.", READY_PAYLOAD);
  llm.briefMode = true;
  llm.briefPayload = { ...READY_PAYLOAD, timeline: "3 months" };
  const upd = await chat(v, { message: "Timeline is 3 months.", conversationId });
  llm.briefMode = false;
  llm.briefPayload = null;
  expect(upd.status === 200, `chat failed: ${JSON.stringify(upd.json)}`);

  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  expect(conv?.briefId === briefId, `pointer drifted: ${conv?.briefId} !== ${briefId}`);
  const row = await prisma.projectBrief.findUnique({ where: { id: briefId } });
  expect(row, "brief disappeared");
  expect(row!.conversationId === conversationId, "brief does not belong to its conversation");
  expect(row!.timeline === "3 months", `AI update not applied: ${row!.timeline}`);
  const count = await prisma.projectBrief.count({ where: { conversationId } });
  expect(count === 1, `duplicate briefs: ${count}`);
});

// Test L5 — insufficient content creates a DRAFT brief (not confirmable).
await test("L5 — insufficient brief stays draft with no confirmedAt", async () => {
  const v = newVisitor();
  const { conversationId, briefId } = await newConversation(v, "Just an idea for now.", INSUFFICIENT_PAYLOAD);
  expect(!!briefId, "no brief created");
  const row = await prisma.projectBrief.findUnique({ where: { id: briefId } });
  expect(row?.status === "draft", `expected draft, got ${row?.status}`);
  expect(row?.confirmedAt === null, "confirmedAt must be null on a draft");
  flow = { v, conversationId, briefId };
});

// Test L6 — a client payload cannot falsely confirm a draft (server rejects;
// injected status/confirmedAt are never applied).
await test("L6 — draft cannot be falsely confirmed via client payload", async () => {
  const res = await confirmBrief(flow.v, {
    conversationId: flow.conversationId,
    briefId: flow.briefId,
    status: "confirmed", // attempted bypass
    confirmedAt: "2000-01-01T00:00:00.000Z", // attempted spoof
    briefUpdates: { status: "confirmed", confirmedAt: "2000-01-01T00:00:00.000Z" },
  });
  expect(res.status === 409, `expected 409, got ${res.status}: ${JSON.stringify(res.json)}`);
  const row = await prisma.projectBrief.findUnique({ where: { id: flow.briefId } });
  expect(row?.status === "draft", `status must stay draft, got ${row?.status}`);
  expect(row?.confirmedAt === null, "confirmedAt must stay null");
});

// Test L7 — once enough meaningful information exists, DRAFT → REVIEW.
await test("L7 — eligible brief transitions draft → review", async () => {
  const brief = await applyProjectBriefUpdate({
    conversationId: flow.conversationId,
    edits: {
      problem: "Clinics lose bookings without an online system.",
      goal: "A booking platform that prevents double-booking.",
      features: ["online booking", "reminders"],
    },
  });
  expect(brief.status === "review", `expected review, got ${brief.status}`);
  const row = await prisma.projectBrief.findUnique({ where: { id: flow.briefId } });
  expect(row?.status === "review", `DB status: ${row?.status}`);
  expect(row?.confirmedAt === null, "no confirmation timestamp before confirmation");
});

// Test L8 — REVIEW → CONFIRMED with a SERVER-generated confirmedAt
// (client-supplied status/confirmedAt are dropped by the allow-list).
await test("L8 — review → confirmed with server-generated confirmedAt", async () => {
  const before = Date.now();
  const res = await confirmBrief(flow.v, {
    conversationId: flow.conversationId,
    briefId: flow.briefId,
    status: "confirmed",
    confirmedAt: "2000-01-01T00:00:00.000Z",
    briefUpdates: { confirmedAt: "2000-01-01T00:00:00.000Z", id: "spoofed", conversation_id: "spoofed" },
  });
  expect(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  expect((res.json as { brief?: { status?: string } }).brief?.status === "confirmed", "wire brief not confirmed");
  const row = await prisma.projectBrief.findUnique({ where: { id: flow.briefId } });
  expect(row?.status === "confirmed", `DB status: ${row?.status}`);
  expect(!!row?.confirmedAt, "confirmedAt missing");
  const ts = row!.confirmedAt!.getTime();
  expect(ts >= before - 1000 && ts <= Date.now() + 1000, `confirmedAt not server-generated now: ${row!.confirmedAt}`);
});

// Test L9 — optional gaps (budget/timeline/platform/…) do NOT block confirmation.
await test("L9 — optional missing data does not block confirmation", async () => {
  const v = newVisitor();
  const { conversationId, briefId } = await newConversation(v, "A small internal tool.", READY_PAYLOAD);
  const row = await prisma.projectBrief.findUnique({ where: { id: briefId } });
  const readiness = JSON.parse(row!.readiness || "{}") as { missingOptional?: string[] };
  expect(
    Array.isArray(readiness.missingOptional) && readiness.missingOptional.length > 0,
    `expected optional gaps in readiness, got ${JSON.stringify(readiness)}`
  );
  const res = await confirmBrief(v, { conversationId, briefId });
  expect(res.status === 200, `optional gaps must not block: ${res.status} ${JSON.stringify(res.json)}`);
});

// Test L10 — repeating the same confirmation is idempotent (timestamp unchanged).
await test("L10 — repeated confirmation is idempotent", async () => {
  const first = await prisma.projectBrief.findUnique({ where: { id: flow.briefId } });
  const res = await confirmBrief(flow.v, { conversationId: flow.conversationId, briefId: flow.briefId });
  expect(res.status === 200, `expected 200, got ${res.status}`);
  const second = await prisma.projectBrief.findUnique({ where: { id: flow.briefId } });
  expect(second?.status === "confirmed", "still confirmed");
  expect(
    second!.confirmedAt!.getTime() === first!.confirmedAt!.getTime(),
    "confirmedAt must not change on an idempotent re-confirmation"
  );
});

// Test L11 — editing a CONFIRMED brief invalidates the confirmation
// (confirmed → review, confirmedAt cleared) and blocks the lead until re-confirmed.
await test("L11 — editing a confirmed brief invalidates confirmation", async () => {
  const updated = await applyProjectBriefUpdate({
    conversationId: flow.conversationId,
    edits: { additional_notes: "Visitor corrected a requirement after confirming." },
  });
  expect(updated.status === "review", `expected review after edit, got ${updated.status}`);
  const row = await prisma.projectBrief.findUnique({ where: { id: flow.briefId } });
  expect(row?.confirmedAt === null, "confirmedAt must be cleared when a confirmed brief is edited");

  const leadRes = await lead(flow.v, { conversationId: flow.conversationId, briefId: flow.briefId, ...CONTACT });
  expect(leadRes.status === 403, `invalidated brief must not hand off, got ${leadRes.status}`);
  expect((await prisma.lead.count({ where: { conversationId: flow.conversationId } })) === 0, "lead must not exist");
});

// Test L12 — after the edit, a NEW explicit confirmation is required and issued.
await test("L12 — edited confirmed brief requires reconfirmation", async () => {
  const prev = (await prisma.projectBrief.findUnique({ where: { id: flow.briefId } }))!.confirmedAt;
  expect(prev === null, "precondition: confirmation was invalidated");
  const res = await confirmBrief(flow.v, { conversationId: flow.conversationId, briefId: flow.briefId });
  expect(res.status === 200, `reconfirmation failed: ${res.status} ${JSON.stringify(res.json)}`);
  const row = await prisma.projectBrief.findUnique({ where: { id: flow.briefId } });
  expect(row?.status === "confirmed", `status: ${row?.status}`);
  expect(!!row?.confirmedAt, "new confirmedAt required");
});

// Test L13 — answered assumptions/open questions are reconciled out of the
// collections when the structured field becomes known.
await test("L13 — assumption and open question reconciled when fields answered", async () => {
  const v = newVisitor();
  const { conversationId } = await newConversation(v, "Shop with assumptions.", READY_PAYLOAD);
  // READY_PAYLOAD ships assumptions ["budget TBD"] and open_questions ["Which timeline?"].
  const before = await prisma.projectBrief.findUnique({ where: { conversationId } });
  expect(before!.assumptions.includes("budget TBD"), "precondition: assumption present");
  expect(before!.openQuestions.includes("Which timeline?"), "precondition: open question present");

  await applyProjectBriefUpdate({ conversationId, edits: { budget: "10000 USD", timeline: "2 months" } });
  const after = await prisma.projectBrief.findUnique({ where: { conversationId } });
  expect(
    !after!.assumptions.some((a) => a.toLowerCase().includes("budget")),
    `stale assumption: ${JSON.stringify(after!.assumptions)}`
  );
  expect(
    !after!.openQuestions.some((q) => q.toLowerCase().includes("timeline")),
    `stale question: ${JSON.stringify(after!.openQuestions)}`
  );
});

// Test L14 — an assumption that contradicts a confirmed requirement is dropped.
await test("L14 — contradictory assumption reconciled", async () => {
  const v = newVisitor();
  const { conversationId } = await newConversation(v, "Portal with search.", READY_PAYLOAD); // features include "search"
  await applyProjectBriefUpdate({
    conversationId,
    edits: { assumptions: ["search", "budget TBD"] }, // "search" is already a confirmed feature
  });
  const row = await prisma.projectBrief.findUnique({ where: { conversationId } });
  expect(
    !row!.assumptions.some((a) => a.trim().toLowerCase() === "search"),
    `contradictory assumption kept: ${JSON.stringify(row!.assumptions)}`
  );
});

// Test L15 — an insufficient brief can never be confirmed (direct server path),
// and client attempts to smuggle status/confirmedAt through edits are dropped.
await test("L15 — insufficient brief confirmation rejected", async () => {
  const v = newVisitor();
  const { conversationId } = await newConversation(v, "Too early to confirm.", INSUFFICIENT_PAYLOAD);
  await expectApiError(() => confirmProjectBrief(conversationId, {}), 409, "confirm insufficient");
  await applyProjectBriefUpdate({
    conversationId,
    edits: { status: "confirmed", confirmedAt: "2000-01-01T00:00:00.000Z" }, // must be ignored
  });
  const row = await prisma.projectBrief.findUnique({ where: { conversationId } });
  expect(row?.status === "draft", `must stay draft, got ${row?.status}`);
  expect(row?.confirmedAt === null, "confirmedAt must remain null");
});

// Test L16 — LEAD uses the authoritative brief (invariant C) and locks it (§7).
await test("L16 — handoff uses authoritative brief and locks it", async () => {
  const res = await lead(flow.v, { conversationId: flow.conversationId, briefId: flow.briefId, ...CONTACT });
  expect(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  const leadRow = await prisma.lead.findUnique({
    where: { id: String((res.json as { leadId?: string }).leadId) },
  });
  expect(leadRow, "lead missing");
  const conv = await prisma.conversation.findUnique({ where: { id: flow.conversationId } });
  expect(conv?.status === "completed", `conversation: ${conv?.status}`);
  expect(leadRow!.projectBriefId === flow.briefId, "lead does not reference the authoritative brief");
  expect(conv!.briefId === flow.briefId, "pointer drifted at handoff");
  const row = await prisma.projectBrief.findUnique({ where: { id: flow.briefId } });
  expect(row?.status === "locked", `expected locked, got ${row?.status}`);
  expect(!!row?.confirmedAt, "locked brief must retain its confirmation timestamp (invariant E/F)");
});

// Test L17 — a LOCKED brief rejects every content edit with 409.
await test("L17 — locked brief edit rejected", async () => {
  await expectApiError(
    () => applyProjectBriefUpdate({ conversationId: flow.conversationId, edits: { additional_notes: "sneaky edit" } }),
    409,
    "locked edit"
  );
  const row = await prisma.projectBrief.findUnique({ where: { id: flow.briefId } });
  expect(
    row!.additionalNotes === "Visitor corrected a requirement after confirming.",
    `locked content changed: ${row!.additionalNotes}`
  );
});

// Test L18 — a LOCKED brief rejects confirmation attempts with 409.
await test("L18 — locked brief confirmation rejected", async () => {
  const res = await confirmBrief(flow.v, { conversationId: flow.conversationId, briefId: flow.briefId });
  expect(res.status === 409, `expected 409, got ${res.status}: ${JSON.stringify(res.json)}`);
  expect(String(res.json?.error).includes("locked"), `unexpected error: ${JSON.stringify(res.json)}`);
  await expectApiError(() => confirmProjectBrief(flow.conversationId, {}), 409, "direct locked confirm");
});

// Test L19 — completed conversation + draft brief: every path is rejected
// (confirmation, chat reuse, lead) and no lead can ever appear (invariants D/E).
await test("L19 — completed conversation with draft brief is rejected everywhere", async () => {
  const v = newVisitor();
  const { conversationId, briefId } = await newConversation(v, "Draft-only project.", INSUFFICIENT_PAYLOAD);
  // Simulate an inconsistent legacy row (the normal flow can never produce this):
  await prisma.conversation.update({ where: { id: conversationId }, data: { status: "completed" } });

  const c = await confirmBrief(v, { conversationId, briefId });
  expect(c.status === 409, `confirm on completed conversation: expected 409, got ${c.status}`);
  const ch = await chat(v, { message: "one more thing", conversationId });
  expect(ch.status === 409, `chat on completed conversation: expected 409, got ${ch.status}`);
  const l = await lead(v, { conversationId, briefId, ...CONTACT });
  // Completed-with-no-lead is a lifecycle conflict (409), checked before the
  // brief gate — either way no lead can ever appear.
  expect(l.status === 409, `lead on completed conversation: expected 409, got ${l.status}`);
  expect((await prisma.lead.count({ where: { conversationId } })) === 0, "a lead must never appear");
  const row = await prisma.projectBrief.findUnique({ where: { id: briefId } });
  expect(row?.status === "draft", "draft must remain draft");
});

// Test L20 — LEAD cannot use an unrelated (foreign) brief.
await test("L20 — lead cannot use an unrelated brief", async () => {
  const vA = newVisitor();
  const a = await newConversation(vA, "Project A.", READY_PAYLOAD);
  const vB = newVisitor();
  const b = await newConversation(vB, "Project B.", READY_PAYLOAD);
  expect(a.briefId !== b.briefId, "precondition: distinct briefs");
  const res = await lead(vA, { conversationId: a.conversationId, briefId: b.briefId, ...CONTACT });
  expect(res.status === 404, `expected 404, got ${res.status}: ${JSON.stringify(res.json)}`);
  expect((await prisma.lead.count({ where: { conversationId: a.conversationId } })) === 0, "no lead created");
});

// Test L21 — duplicate open questions/assumptions are deduplicated (§18):
// the same question may never appear twice, in any casing/punctuation variant,
// and re-submitting it in a later update must not re-introduce a copy.
await test("L21 — duplicate questions and assumptions are removed", async () => {
  const v = newVisitor();
  const { conversationId } = await newConversation(v, "Duplicates everywhere.", {
    ...READY_PAYLOAD,
    assumptions: ["Budget TBD", "budget tbd", "Budget TBD?"],
    open_questions: ["Which timeline?", "which timeline"],
  });
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

  const row = await prisma.projectBrief.findUnique({ where: { conversationId } });
  expect(row, "brief missing");
  expect(
    row!.openQuestions.length === 1,
    `duplicate questions kept: ${JSON.stringify(row!.openQuestions)}`
  );
  expect(
    row!.assumptions.length === 1,
    `duplicate assumptions kept: ${JSON.stringify(row!.assumptions)}`
  );

  // A later update repeating an existing question must not create a second copy.
  await applyProjectBriefUpdate({
    conversationId,
    edits: { open_questions: ["Which timeline?", "Which platform?"] },
  });
  const after = await prisma.projectBrief.findUnique({ where: { conversationId } });
  expect(
    after!.openQuestions.filter((q) => norm(q) === "which timeline").length === 1,
    `repeated question re-introduced: ${JSON.stringify(after!.openQuestions)}`
  );
  expect(after!.openQuestions.length === 2, `unexpected questions: ${JSON.stringify(after!.openQuestions)}`);
});

// ── concurrency matrix (spec §22, tests A–E) ─────────────────────────────────

// Test A — two simultaneous FIRST brief creations → one brief, one pointer.
await test("CA — concurrent brief creation yields exactly one brief", async () => {
  const v = newVisitor();
  const { conversationId } = await newConversation(v, "Race me.");
  const edits = { project_name: "Race Project", problem: "P", goal: "G", features: ["f1"] };
  const [r1, r2] = await Promise.all([
    applyProjectBriefUpdate({ conversationId, edits }),
    applyProjectBriefUpdate({ conversationId, edits }),
  ]);
  expect(r1.id === r2.id, `both callers must converge on one brief: ${r1.id} vs ${r2.id}`);
  expect((await prisma.projectBrief.count({ where: { conversationId } })) === 1, "more than one brief row");
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  expect(conv?.briefId === r1.id, `pointer wrong: ${conv?.briefId}`);
});

// Test B — two simultaneous updates → no duplicates, valid pointer, both applied.
await test("CB — concurrent updates keep one brief and a valid pointer", async () => {
  const v = newVisitor();
  const { conversationId, briefId } = await newConversation(v, "Update race.", READY_PAYLOAD);
  await Promise.all([
    applyProjectBriefUpdate({ conversationId, edits: { timeline: "4 months" } }),
    applyProjectBriefUpdate({ conversationId, edits: { budget: "20000 USD" } }),
  ]);
  expect((await prisma.projectBrief.count({ where: { conversationId } })) === 1, "duplicate brief rows");
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  expect(conv?.briefId === briefId, `pointer broken: ${conv?.briefId}`);
  const row = await prisma.projectBrief.findUnique({ where: { id: briefId } });
  expect(
    row!.timeline === "4 months" && row!.budget === "20000 USD",
    `final content invalid: timeline=${row!.timeline} budget=${row!.budget}`
  );
  expect(row!.status === "draft" || row!.status === "review", `invalid status: ${row!.status}`);
});

// Test C — two simultaneous confirmations → both safe, one authoritative result.
await test("CC — concurrent confirmations are safe and idempotent", async () => {
  const v = newVisitor();
  const { conversationId, briefId } = await newConversation(v, "Confirm race.", READY_PAYLOAD);
  const [c1, c2] = await Promise.all([
    confirmBrief(v, { conversationId, briefId }),
    confirmBrief(v, { conversationId, briefId }),
  ]);
  expect(c1.status === 200 && c2.status === 200, `both confirmations must succeed: ${c1.status}/${c2.status}`);
  const b1 = (c1.json as { brief?: { id?: string; status?: string } }).brief;
  const b2 = (c2.json as { brief?: { id?: string; status?: string } }).brief;
  expect(b1?.id === briefId && b2?.id === briefId, "both must return the authoritative brief");
  expect(b1?.status === "confirmed" && b2?.status === "confirmed", "both must report confirmed");
  const row = await prisma.projectBrief.findUnique({ where: { id: briefId } });
  expect(row?.status === "confirmed" && !!row?.confirmedAt, "single confirmed row with timestamp");
});

// Test D — confirmation racing an edit → no impossible state ever
// (confirmed ⇔ confirmedAt present; draft/review ⇒ no timestamp).
await test("CD — confirmation racing an edit never yields an impossible state", async () => {
  const v = newVisitor();
  const { conversationId, briefId } = await newConversation(v, "Edit race.", READY_PAYLOAD);
  await Promise.all([
    confirmBrief(v, { conversationId, briefId }),
    applyProjectBriefUpdate({ conversationId, edits: { additional_notes: "raced edit" } }),
  ]);
  const row = await prisma.projectBrief.findUnique({ where: { id: briefId } });
  expect(row, "brief missing");
  expect(["draft", "review", "confirmed"].includes(row!.status), `invalid status: ${row!.status}`);
  if (row!.status === "confirmed") {
    expect(!!row!.confirmedAt, "confirmed without confirmedAt — impossible state");
  } else {
    expect(row!.confirmedAt === null, `${row!.status} with a stale confirmedAt — impossible state`);
  }
});

// Test E — lead handoff racing a brief modification → exactly one consistent
// outcome, never a Lead referencing a mutable post-handoff brief.
await test("CE — handoff racing a brief modification is consistent", async () => {
  const v = newVisitor();
  const { conversationId, briefId } = await newConversation(v, "Handoff race.", READY_PAYLOAD);
  const ok = await confirmBrief(v, { conversationId, briefId });
  expect(ok.status === 200, `confirm failed: ${ok.status}`);

  const [leadRes] = await Promise.all([
    lead(v, { conversationId, briefId, ...CONTACT }),
    applyProjectBriefUpdate({ conversationId, edits: { additional_notes: "post-confirm race" } }),
  ]);
  const row = await prisma.projectBrief.findUnique({ where: { id: briefId } });
  const leadCount = await prisma.lead.count({ where: { conversationId } });

  if (leadRes.status === 200) {
    // Handoff won → brief must be locked and immutable from now on.
    expect(row?.status === "locked", `expected locked after handoff, got ${row?.status}`);
    expect(leadCount === 1, `expected exactly 1 lead, got ${leadCount}`);
    await expectApiError(
      () => applyProjectBriefUpdate({ conversationId, edits: { additional_notes: "after lock" } }),
      409,
      "post-lock edit"
    );
    const final = await prisma.projectBrief.findUnique({ where: { id: briefId } });
    expect(final!.additionalNotes !== "after lock", "locked brief was modified after handoff");
  } else {
    // The edit invalidated confirmation first → handoff safely refused.
    expect(leadRes.status === 403 || leadRes.status === 409, `unexpected lead status: ${leadRes.status}`);
    expect(leadCount === 0, "no lead may exist when the handoff was refused");
    expect(row?.status !== "locked", "brief must not be locked without a handoff");
    expect(row?.confirmedAt === null, "invalidated confirmation must not survive");
  }
});

// ── summary ──────────────────────────────────────────────────────────────────

summarize("Phase 2 lifecycle matrix");
await prisma.$disconnect();

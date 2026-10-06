// Executable security test matrix — Phase 1 (session ownership, data
// integrity, handoff protection).
//
// Drives the REAL Next.js route handlers with NextRequest against a real
// local PostgreSQL test database. The LLM is replaced through the module's
// supported extension point (setLLMProvider) with a scripted provider, so
// no external API is called. Run: npm run test:security
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
  FARTAK_SESSION_COOKIE,
  type Visitor,
} from "./harness";

const chatRoute = await import("../fartak-intelligence/app/api/fartak/chat/route");
const briefRoute = await import("../fartak-intelligence/app/api/fartak/brief/route");
const leadRoute = await import("../fartak-intelligence/app/api/fartak/lead/route");
const { prisma } = await import("../fartak-intelligence/server/fartak/storage");
const { setLLMProvider } = await import("../fartak-intelligence/server/fartak/provider");
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

// ── fixtures shared across the sequential matrix ────────────────────────────

const visitorA = newVisitor();
const visitorB = newVisitor();
const visitorD = newVisitor();
const visitorE = newVisitor();

let conversationA = "";
let briefA = "";
let leadIdA = "";
let conversationB = "";
let briefB = "";
let conversationD = "";
let briefD = "";
let leadIdD = "";
let confirmedAtD: Date | null = null;
let conversationE = "";
let briefE = "";

const CONTACT_A = { name: "Sina Test", phone: "+98 912 345 6789", preferredContactMethod: "whatsapp" };

// Test 1 — Visitor A creates Conversation A; server-controlled fields ignored.
await test("Test 1 — Visitor A creates Conversation A (client status ignored)", async () => {
  llm.briefMode = false;
  const res = await chat(visitorA, {
    message: "I want to build an AI healthcare platform",
    status: "completed", // client tries to set a server-owned field
  });
  expect(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  conversationA = String((res.json as { conversationId?: string }).conversationId || "");
  expect(conversationA.length > 0, "no conversationId returned");
  const row = await prisma.conversation.findUnique({ where: { id: conversationA } });
  expect(row, "conversation missing from DB");
  expect(row!.ownerTokenHash === hashSessionToken(visitorA.token), "ownerTokenHash does not match session A");
  expect(row!.status === "active", `client-supplied status must be ignored, got '${row!.status}'`);
});

// Test 2 — Visitor B tries to use Conversation A → rejected, non-leaking.
await test("Test 2 — Visitor B cannot use Conversation A (generic 404)", async () => {
  const res = await chat(visitorB, { message: "hijack attempt", conversationId: conversationA });
  expect(res.status === 404, `expected 404, got ${res.status}`);
  expect(res.json?.error === "Conversation not found", `unexpected error: ${JSON.stringify(res.json)}`);
  // A nonexistent id must be indistinguishable from a foreign one.
  const ghost = await chat(visitorB, { message: "probe", conversationId: "ckxx0000000000000000000000000000" });
  expect(ghost.status === 404, `expected 404 for unknown id, got ${ghost.status}`);
  expect(ghost.json?.error === res.json?.error, "foreign vs unknown id responses must be identical");
});

// Test 3 — Visitor A reads/confirms Brief A → success (ownership chain).
await test("Test 3 — Visitor A confirms Brief A", async () => {
  llm.briefMode = true;
  const gen = await chat(visitorA, {
    message: "Details: platform for clinics, appointments and records.",
    conversationId: conversationA,
  });
  llm.briefMode = false;
  expect(gen.status === 200, `brief generation failed: ${JSON.stringify(gen.json)}`);
  const brief = (gen.json as { brief?: { id?: string } | null }).brief;
  briefA = String(brief?.id || "");
  expect(briefA.length > 0, "no brief created");

  const res = await confirmBrief(visitorA, { conversationId: conversationA, briefId: briefA });
  expect(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  expect((res.json as { ok?: boolean }).ok === true, "confirm not ok");
  expect((res.json as { brief?: { status?: string } }).brief?.status === "confirmed", "brief not confirmed");
});

// Test 4 — Visitor B tries to read/confirm Brief A → rejected, non-leaking.
await test("Test 4 — Visitor B cannot access Brief A", async () => {
  const res = await confirmBrief(visitorB, { briefId: briefA, conversationId: conversationA });
  expect(res.status === 404, `expected 404, got ${res.status}`);
  expect(res.json?.error === "Brief not found", `unexpected: ${JSON.stringify(res.json)}`);
  const ghost = await confirmBrief(visitorB, { briefId: "ckxx0000000000000000000000000000" });
  expect(ghost.status === 404 && ghost.json?.error === res.json?.error, "foreign vs unknown brief must be identical");
});

// Test 5 — Visitor A tries to confirm Visitor B's Brief B → rejected.
await test("Test 5 — Visitor A cannot confirm Brief B", async () => {
  llm.briefMode = true;
  const genB = await chat(visitorB, { message: "I need an internal automation tool." });
  llm.briefMode = false;
  expect(genB.status === 200, `B conversation failed: ${JSON.stringify(genB.json)}`);
  conversationB = String((genB.json as { conversationId?: string }).conversationId || "");
  briefB = String(((genB.json as { brief?: { id?: string } }).brief)?.id || "");
  expect(conversationB && briefB, "B fixtures missing");

  const res = await confirmBrief(visitorA, { briefId: briefB }); // no conversationId → derived server-side
  expect(res.status === 404, `expected 404, got ${res.status}`);
  expect(res.json?.error === "Brief not found", `unexpected: ${JSON.stringify(res.json)}`);
});

// Test 6 — Conversation A + Brief B submitted to /lead → rejected.
await test("Test 6 — mismatched Conversation A + Brief B rejected at /lead", async () => {
  const res = await lead(visitorA, {
    conversationId: conversationA,
    briefId: briefB,
    ...CONTACT_A,
  });
  expect(res.status === 404, `expected 404, got ${res.status}: ${JSON.stringify(res.json)}`);
});

// Test 7 — Draft brief at /lead (even with status:'confirmed' injected) → rejected.
await test("Test 7 — draft brief cannot create a Lead (no confirmation bypass)", async () => {
  const res = await lead(visitorB, {
    conversationId: conversationB,
    briefId: briefB,
    status: "confirmed", // attempted bypass
    ...CONTACT_A,
  });
  expect(res.status === 403, `expected 403, got ${res.status}: ${JSON.stringify(res.json)}`);
  const count = await prisma.lead.count({ where: { conversationId: conversationB } });
  expect(count === 0, "no lead may exist for a draft brief");
});

// Test 8 — Confirmed brief + correct conversation + correct session → success.
await test("Test 8 — valid handoff creates Lead + completes conversation", async () => {
  const res = await lead(visitorA, {
    conversationId: conversationA,
    briefId: briefA,
    ...CONTACT_A,
    email: "not-needed@example.com",
  });
  expect(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  const body = res.json as { ok?: boolean; leadId?: string; projectReference?: string };
  expect(body.ok === true, "not ok");
  leadIdA = String(body.leadId || "");
  expect(/^FTK-\d{4}$/.test(String(body.projectReference)), `bad reference: ${body.projectReference}`);
  const conv = await prisma.conversation.findUnique({ where: { id: conversationA } });
  expect(conv?.status === "completed", `conversation not completed: ${conv?.status}`);
  expect(!!conv?.leadId && !!conv?.summary, "leadId/summary not stored server-side");
});

// Test 9 — Same Lead request submitted twice → ONE Lead.
await test("Test 9 — duplicate submission is idempotent (one Lead)", async () => {
  const res = await lead(visitorA, {
    conversationId: conversationA,
    briefId: briefA,
    ...CONTACT_A,
    email: "not-needed@example.com",
  });
  expect(res.status === 200, `expected 200 idempotent result, got ${res.status}`);
  expect((res.json as { leadId?: string }).leadId === leadIdA, "idempotent result must return the existing leadId");
  const count = await prisma.lead.count({ where: { conversationId: conversationA } });
  expect(count === 1, `expected exactly 1 lead, found ${count}`);
});

// Test 10 — Two concurrent Lead submissions → ONE handoff.
await test("Test 10 — concurrent submissions collapse to one handoff", async () => {
  const okB = await confirmBrief(visitorB, { conversationId: conversationB, briefId: briefB });
  expect(okB.status === 200, `B confirm failed: ${JSON.stringify(okB.json)}`);

  const body = {
    conversationId: conversationB,
    briefId: briefB,
    name: "B Visitor",
    phone: "+989121112233",
    preferredContactMethod: "phone",
  };
  const [r1, r2] = await Promise.all([
    lead(visitorB, body, { headers: { "x-fartak-idempotency-key": "concurrent-key-0001" } }),
    lead(visitorB, body, { headers: { "x-fartak-idempotency-key": "concurrent-key-0002" } }),
  ]);
  expect(r1.status === 200 && r2.status === 200, `both must succeed idempotently: ${r1.status}/${r2.status}`);
  expect((r1.json as { leadId?: string }).leadId === (r2.json as { leadId?: string }).leadId, "same leadId expected");
  const count = await prisma.lead.count({ where: { conversationId: conversationB } });
  expect(count === 1, `expected exactly 1 lead, found ${count}`);
});

// Test 11 — Client attempts to set server-owned brief/conversation fields.
await test("Test 11 — status/confirmedAt/id/conversation_id/readiness from client are ignored", async () => {
  llm.briefMode = true;
  const d = await chat(visitorD, {
    message: "Build me a CRM with pipelines and reporting.",
    status: "completed",
    leadId: "fake-lead",
    summary: "fake summary",
  });
  llm.briefMode = false;
  expect(d.status === 200, `D conversation failed: ${JSON.stringify(d.json)}`);
  conversationD = String((d.json as { conversationId?: string }).conversationId || "");
  briefD = String(((d.json as { brief?: { id?: string } }).brief)?.id || "");
  expect(conversationD && briefD, "D fixtures missing");
  const convRow = await prisma.conversation.findUnique({ where: { id: conversationD } });
  expect(convRow?.status === "active" && !convRow?.leadId && !convRow?.summary, "client-set conversation fields leaked");

  const res = await confirmBrief(visitorD, {
    conversationId: conversationD,
    briefId: briefD,
    status: "draft", // top-level junk — ignored
    confirmedAt: "2000-01-01T00:00:00.000Z", // top-level junk — ignored
    id: "hax",
    briefUpdates: {
      status: "confirmed",
      conversation_id: "evil",
      confirmedAt: "2000-01-01T00:00:00.000Z",
      id: "evil",
      readiness: { ready: true, missingCritical: [], missingOptional: [] },
      project_name: "Edited Name", // legitimate edit — must be applied
      features: Array.from({ length: 100 }, () => "f".repeat(500)), // over cap
    },
  });
  expect(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  const row = await prisma.projectBrief.findUnique({ where: { id: briefD } });
  expect(row, "brief missing");
  expect(row!.id === briefD, "brief id changed");
  expect(row!.conversationId === conversationD, "conversationId changed");
  expect(row!.status === "confirmed", "status must be server-set to confirmed");
  expect(row!.confirmedAt !== null && row!.confirmedAt!.toISOString() !== "2000-01-01T00:00:00.000Z", "confirmedAt must be server-generated");
  confirmedAtD = row!.confirmedAt;
  expect(row!.projectName === "Edited Name", "legitimate edit not applied");
  expect(row!.features.length === 60, `features must be capped at 60, got ${row!.features.length}`);
  expect(row!.features.every((f) => f.length <= 300), "feature items must be capped at 300 chars");
  expect((row!.readiness || "").includes("missingCritical"), "readiness must be preserved (not client-writable)");
});

// Test 12 — Fake projectReference from client → server generates its own.
await test("Test 12 — client-supplied projectReference is ignored", async () => {
  const res = await lead(visitorD, {
    conversationId: conversationD,
    briefId: briefD,
    name: "D Visitor",
    phone: "09121234567",
    preferredContactMethod: "email",
    email: "d@example.com",
    projectReference: "FTK-9999",
  });
  expect(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  const ref = String((res.json as { projectReference?: string }).projectReference);
  leadIdD = String((res.json as { leadId?: string }).leadId);
  expect(ref !== "FTK-9999", "client-chosen reference must not be used");
  expect(/^FTK-\d{4}$/.test(ref), `bad reference: ${ref}`);
  const row = await prisma.lead.findUnique({ where: { conversationId: conversationD } });
  expect(row?.projectReference === ref, "DB reference must match server-generated value");
});

// Test 13 — confirmedAt sent with lead payload → ignored.
await test("Test 13 — confirmedAt from client never reaches the database", async () => {
  const row = await prisma.projectBrief.findUnique({ where: { id: briefD } });
  expect(row?.confirmedAt !== null, "brief must still be confirmed");
  expect(
    row!.confirmedAt!.toISOString() === confirmedAtD!.toISOString(),
    "lead submission must not rewrite confirmedAt"
  );
});

// Test 14 — Completed conversation submits another lead → idempotent, never a 2nd Lead.
await test("Test 14 — completed conversation: idempotent result, no second Lead, chat blocked", async () => {
  const res = await lead(visitorD, {
    conversationId: conversationD,
    briefId: briefD,
    name: "D Visitor",
    phone: "09121234567",
    preferredContactMethod: "phone",
  });
  expect(res.status === 200, `expected idempotent 200, got ${res.status}`);
  expect((res.json as { leadId?: string }).leadId === leadIdD, "must return the existing lead");
  const count = await prisma.lead.count({ where: { conversationId: conversationD } });
  expect(count === 1, `expected exactly 1 lead, found ${count}`);
  // Reusing a completed conversation for a new chat exchange is rejected.
  const chatRes = await chat(visitorD, { message: "one more thing", conversationId: conversationD });
  expect(chatRes.status === 409, `expected 409 for completed conversation, got ${chatRes.status}`);
});

// Test 15 — Malformed payloads → 400 with safe messages.
await test("Test 15 — malformed payloads rejected with 400", async () => {
  const badJson = await chat(visitorD, undefined, { rawBody: "{not valid json" });
  expect(badJson.status === 400, `expected 400 for invalid JSON, got ${badJson.status}`);
  expect(badJson.json?.error === "Invalid JSON payload", `unexpected: ${JSON.stringify(badJson.json)}`);
  const array = await lead(visitorD, undefined, { rawBody: "[1,2,3]" });
  expect(array.status === 400, `expected 400 for array body, got ${array.status}`);
  const missing = await confirmBrief(visitorD, {});
  expect(missing.status === 400 && missing.json?.error === "Missing brief", "missing briefId must 400");
});

// Test 16 — Huge payloads → rejected safely.
await test("Test 16 — oversized payload rejected", async () => {
  const huge = JSON.stringify({ message: "x".repeat(100_000) });
  const res = await chat(visitorD, undefined, { rawBody: huge });
  expect(res.status === 413, `expected 413, got ${res.status}`);
});

// Test 17 — Invalid contact method → rejected (server config authoritative).
await test("Test 17 — unsupported contact method rejected", async () => {
  llm.briefMode = true;
  const e = await chat(visitorE, { message: "An internal dashboard for my team." });
  llm.briefMode = false;
  expect(e.status === 200, `E conversation failed: ${JSON.stringify(e.json)}`);
  conversationE = String((e.json as { conversationId?: string }).conversationId || "");
  briefE = String(((e.json as { brief?: { id?: string } }).brief)?.id || "");
  expect(conversationE && briefE, "E fixtures missing");
  const ok = await confirmBrief(visitorE, { conversationId: conversationE, briefId: briefE });
  expect(ok.status === 200, `E confirm failed: ${JSON.stringify(ok.json)}`);

  const res = await lead(visitorE, {
    conversationId: conversationE,
    briefId: briefE,
    name: "E Visitor",
    phone: "+989123334455",
    preferredContactMethod: "pigeon", // not in serverConfig.contactMethods
  });
  expect(res.status === 400, `expected 400, got ${res.status}`);
  expect(res.json?.error === "Unsupported contact method", `unexpected: ${JSON.stringify(res.json)}`);
});

// Test 18 — Email as preferred method without email → rejected.
await test("Test 18 — email contact without email rejected", async () => {
  const res = await lead(visitorE, {
    conversationId: conversationE,
    briefId: briefE,
    name: "E Visitor",
    phone: "+989123334455",
    preferredContactMethod: "email",
  });
  expect(res.status === 400, `expected 400, got ${res.status}`);
  expect(String(res.json?.error).includes("Email is required"), `unexpected: ${JSON.stringify(res.json)}`);
  const count = await prisma.lead.count({ where: { conversationId: conversationE } });
  expect(count === 0, "no lead may exist after rejected submissions");
});

// Extra A — the public GET brief endpoint is gone entirely.
await test("Extra A — GET /api/fartak/brief is removed", async () => {
  expect(typeof (briefRoute as { GET?: unknown }).GET === "undefined", "GET handler must not exist");
});

// Extra B — session cookie flags: HttpOnly, SameSite=Lax, Path=/.
await test("Extra B — first response mints a secure HttpOnly session cookie", async () => {
  const res = await callAs(null, chatRoute.POST, "/api/fartak/chat", { body: { message: "hello" } });
  expect(res.status === 200, `expected 200, got ${res.status}`);
  const cookie = res.setCookie || "";
  expect(cookie.includes(FARTAK_SESSION_COOKIE), `no session cookie set: ${cookie}`);
  expect(cookie.includes("HttpOnly"), `cookie must be HttpOnly: ${cookie}`);
  expect(cookie.toLowerCase().includes("samesite=lax"), `cookie must be SameSite=lax: ${cookie}`);
  expect(cookie.includes("Path=/"), `cookie must be Path=/: ${cookie}`);
});

// Extra C — cross-origin POST is rejected (CSRF for state-changing routes).
await test("Extra C — cross-origin POST rejected with 403", async () => {
  const res = await chat(visitorA, { message: "csrf attempt" }, { origin: "http://evil.example" });
  expect(res.status === 403, `expected 403, got ${res.status}`);
  expect(res.json?.error === "Invalid request origin", `unexpected: ${JSON.stringify(res.json)}`);
});

// Extra D — rate limit returns 429 once the per-key budget is exhausted.
await test("Extra D — rate limiting returns 429 after the limit", async () => {
  const v = newVisitor();
  let last = 0;
  for (let i = 0; i < 21; i++) {
    const res = await chat(v, {});
    last = res.status;
    if (res.status === 429) break;
    expect(res.status === 400, `unexpected pre-limit status ${res.status} at request ${i + 1}`);
  }
  expect(last === 429, `expected 429 on the 21st request, last status was ${last}`);
});

// Extra E — a malformed/forged session cookie is treated as anonymous.
await test("Extra E — malformed session cookie falls back to a fresh session", async () => {
  const res = await callAs(null, chatRoute.POST, "/api/fartak/chat", {
    body: { message: "forged cookie" },
    headers: { cookie: `${FARTAK_SESSION_COOKIE}=short` },
  });
  expect(res.status === 200, `expected 200 with re-minted session, got ${res.status}`);
  expect((res.setCookie || "").includes("HttpOnly"), "a fresh cookie must be issued");
});

// ── summary ─────────────────────────────────────────────────────────────────

summarize("Phase 1 security matrix");
await prisma.$disconnect();


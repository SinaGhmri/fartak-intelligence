// Shared test harness for the Phase 1 security and Phase 2 lifecycle matrices.
// Both suites drive the REAL Next.js route handlers with NextRequest against
// a real local PostgreSQL test database, with the LLM replaced through the
// module's supported extension point (setLLMProvider).
//
// Environment defaults live here and are set at module load — suites import
// this file FIRST (static import) and only then dynamically import the
// modules under test, so DATABASE_URL/FARTAK_LLM_API_KEY always exist first.

process.env.DATABASE_URL ??= "postgresql://127.0.0.1:5432/fartak_test";
process.env.FARTAK_LLM_API_KEY ??= "test-key-not-real";

import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { FARTAK_SESSION_COOKIE } from "../fartak-intelligence/server/fartak/session";

export { FARTAK_SESSION_COOKIE };

// ── tiny test runner ────────────────────────────────────────────────────────

let passed = 0;
const failures: string[] = [];

export async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures.push(name);
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}\n      ${msg}`);
  }
}

export function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function summarize(label: string): void {
  console.log(`\n${label}: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("Failed tests:");
    for (const f of failures) console.log(` - ${f}`);
    process.exitCode = 1;
  }
}

// ── visitors & request helpers ──────────────────────────────────────────────

export interface Visitor {
  token: string;
}

export function newVisitor(): Visitor {
  // Each simulated browser gets its own opaque session token, exactly as the
  // server would mint one (valid base64url, 32 bytes).
  return { token: randomBytes(32).toString("base64url") };
}

export interface CallResult {
  status: number;
  json: Record<string, unknown> | null;
  setCookie: string | null;
}

export type Handler = (req: InstanceType<typeof NextRequest>) => Promise<Response>;

export async function callAs(
  visitor: Visitor | null,
  handler: Handler,
  path: string,
  options: { body?: unknown; rawBody?: string; origin?: string | null; headers?: Record<string, string> } = {}
): Promise<CallResult> {
  const headers: Record<string, string> = {
    host: "localhost:3000",
  };
  const origin = options.origin === undefined ? "http://localhost:3000" : options.origin;
  if (origin) headers.origin = origin;
  if (visitor) headers.cookie = `${FARTAK_SESSION_COOKIE}=${visitor.token}`;
  if (options.headers) Object.assign(headers, options.headers);

  const hasBody = options.rawBody !== undefined || options.body !== undefined;
  if (hasBody && !options.headers?.["content-type"]) headers["content-type"] = "application/json";

  type NextInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>;
  const init: NextInit & { duplex?: "half" } = { method: "POST", headers };
  if (hasBody) {
    init.body = options.rawBody !== undefined ? options.rawBody : JSON.stringify(options.body);
    init.duplex = "half";
  }

  const res = await handler(new NextRequest(`http://localhost:3000${path}`, init));
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json, setCookie: res.headers.get("set-cookie") };
}

// ── scripted LLM (supported extension point — no external API) ──────────────

export const DEFAULT_BRIEF_PAYLOAD: Record<string, unknown> = {
  project_name: "Matrix Test Project",
  project_type: "web_app",
  problem: "The visitor described a concrete problem to solve.",
  goal: "A web platform that solves it.",
  features: ["user accounts", "dashboard"],
  assumptions: ["budget TBD"],
  open_questions: ["Which timeline?"],
};

export class ScriptedProvider {
  /** While true, chat replies include a project brief. */
  briefMode = false;
  /** Override the brief content sent by the chat replies (defaults to DEFAULT_BRIEF_PAYLOAD). */
  briefPayload: Record<string, unknown> | null = null;

  async complete(_prompt: string, schema?: Record<string, unknown>): Promise<unknown> {
    const properties = (schema?.properties ?? {}) as Record<string, unknown>;
    if ("summary" in properties) {
      return { summary: "Visitor wants a web platform; requirements captured in the brief." };
    }
    const reply: Record<string, unknown> = { reply: "Understood — tell me more about your project." };
    if (this.briefMode && "brief" in properties) {
      reply.brief = this.briefPayload ?? DEFAULT_BRIEF_PAYLOAD;
      reply.readiness = { ready: true, missingCritical: [], missingOptional: [] };
    }
    return reply;
  }
}

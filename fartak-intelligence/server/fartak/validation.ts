// Server-side request validation. Everything a client sends is untrusted:
// bodies are size-bounded before parsing, brief edits pass a strict field
// allow-list (server-owned fields are dropped, not filtered downstream), and
// contact data is validated against server configuration only.
//
// ApiError carries a SAFE user-facing message — raw errors (Prisma, SQL,
// provider internals) never reach a visitor; routes log them instead.

import type { NextRequest } from "next/server";
import { serverConfig } from "./config";
import type { ProjectBriefEdits } from "../../lib/fartak/types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly userMessage: string
  ) {
    super(userMessage);
    this.name = "ApiError";
  }
}

/** Maximum raw request bodies, in bytes, per endpoint. */
export const MAX_BODY_BYTES = {
  chat: 32_768, // messages are capped at 2000 chars anyway
  brief: 65_536,
  lead: 16_384,
} as const;

/**
 * Read and parse a JSON object body with a hard size cap. Oversized bodies
 * are rejected before they are fully buffered/parsed (413); malformed or
 * non-object JSON is a 400.
 */
export async function readJsonBody(req: NextRequest, maxBytes: number): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(413, "Request too large");
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new ApiError(413, "Request too large");
  }
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "Invalid JSON payload");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(400, "Invalid payload");
  }
  return parsed as Record<string, unknown>;
}

/** Strict string extraction: non-strings become "" (malformed → 400 downstream). */
export function clientString(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

// ── Project brief edits ─────────────────────────────────────────────────────
// Allow-list mirroring ProjectBriefEdits (the only fields the review UI may
// change). Everything else — id, conversation_id, status, confirmedAt,
// readiness, or any unknown key — is silently dropped, never written.

const BRIEF_STRING_CAPS: Record<
  Exclude<keyof ProjectBriefEdits, "features" | "assumptions" | "open_questions">,
  number
> = {
  project_name: 200,
  project_type: 200,
  problem: 1000,
  goal: 1000,
  target_users: 1000,
  user_roles: 500,
  platform: 200,
  workflows: 1000,
  ai_requirements: 1000,
  integrations: 1000,
  constraints: 1000,
  mvp_scope: 1000,
  future_scope: 1000,
  timeline: 200,
  budget: 200,
  geographic_scope: 300,
  languages: 300,
  security_privacy: 1000,
  additional_notes: 1000,
};

const BRIEF_ARRAY_CAPS: Record<"features" | "assumptions" | "open_questions", number> = {
  features: 60,
  assumptions: 40,
  open_questions: 40,
};
const BRIEF_ARRAY_ITEM_CAP = 300;

/**
 * Sanitize untrusted brief edits into a ProjectBriefEdits containing only
 * editable fields with bounded sizes. Server-owned fields in the input are
 * discarded right here — they never leave this function.
 */
export function sanitizeBriefEdits(input: unknown): ProjectBriefEdits {
  const out: ProjectBriefEdits = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const src = input as Record<string, unknown>;

  for (const key of Object.keys(BRIEF_STRING_CAPS) as (keyof typeof BRIEF_STRING_CAPS)[]) {
    const value = src[key];
    if (typeof value === "string") {
      (out as Record<string, unknown>)[key] = value.trim().slice(0, BRIEF_STRING_CAPS[key]);
    }
  }
  for (const key of Object.keys(BRIEF_ARRAY_CAPS) as (keyof typeof BRIEF_ARRAY_CAPS)[]) {
    const value = src[key];
    if (Array.isArray(value)) {
      (out as Record<string, unknown>)[key] = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, BRIEF_ARRAY_ITEM_CAP))
        .filter(Boolean)
        .slice(0, BRIEF_ARRAY_CAPS[key]);
    }
  }
  return out;
}

// ── Contact data ────────────────────────────────────────────────────────────

export interface ValidatedContact {
  name: string;
  phone: string;
  email: string | null;
  preferredContactMethod: string;
}

/**
 * Contact validation, server-authoritative. Required: name + phone +
 * preferredContactMethod (must be in serverConfig.contactMethods — never the
 * frontend list). Email is optional unless the chosen method is email.
 * Phone: lenient about international formatting characters, but the digit
 * count must be plausible (7–20; E.164 allows 15, extra slack avoids
 * over-restricting unusual international numbers).
 */
export function validateContact(body: Record<string, unknown>): ValidatedContact {
  const name = clientString(body.name, 120);
  const phone = clientString(body.phone, 40);
  const email = clientString(body.email, 254);
  const preferredContactMethod = clientString(body.preferredContactMethod, 30);

  if (!name || name.length < 2) {
    throw new ApiError(400, "Name and phone number are required");
  }
  if (!phone) {
    throw new ApiError(400, "Name and phone number are required");
  }
  if (!/^[\d\s()+.\-]{5,32}$/.test(phone)) {
    throw new ApiError(400, "Please provide a valid phone number");
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 20) {
    throw new ApiError(400, "Please provide a valid phone number");
  }
  if (!preferredContactMethod || !serverConfig.contactMethods.includes(preferredContactMethod)) {
    throw new ApiError(400, "Unsupported contact method");
  }
  // Email is optional — unless the visitor chose email as the contact method.
  if (preferredContactMethod === "email" && !email) {
    throw new ApiError(400, "Email is required for email contact");
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, "Invalid email");
  }

  return { name, phone, email: email || null, preferredContactMethod };
}

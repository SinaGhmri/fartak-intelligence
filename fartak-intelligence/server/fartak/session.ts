// Secure ANONYMOUS session ownership for the Fartak module.
//
// The visitor never logs in. On the first Fartak request the server mints a
// 256-bit cryptographically random token, hands it to the browser in an
// HttpOnly cookie, and stores only the SHA-256 hash of that token as the
// owner of every Conversation the session creates. Ownership checks compare
// hashes — identifiers (conversationId / briefId) are never proof of
// ownership, and the secret never reaches JavaScript, so XSS cannot exfiltrate
// it. Designed for a same-origin embedded Next.js module: SameSite=Lax
// prevents cross-site POSTs from carrying the cookie.

import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export const FARTAK_SESSION_COOKIE = "fartak_session";

// Guest discovery session expiry: 30 days from minting (absolute). Long
// enough for a slow project-discovery cycle, short enough that abandoned
// sessions stop being usable.
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface AnonymousSession {
  token: string;
  /** SHA-256 hex of the token — what gets stored on rows as ownerTokenHash. */
  hash: string;
  /** True when this request minted a fresh token (cookie must be set). */
  isNew: boolean;
}

/** 32 bytes of CSPRNG entropy → 43-char base64url string. Unpredictable. */
export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Server-issued tokens are always base64url 32-byte values (43 chars).
// Anything else in the cookie is treated as absent — malformed input never
// reaches the hash comparison as a "valid-looking" owner.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function readSessionToken(req: NextRequest): string | null {
  const token = req.cookies.get(FARTAK_SESSION_COOKIE)?.value;
  return token && TOKEN_PATTERN.test(token) ? token : null;
}

/**
 * Resolve (or mint) the anonymous session for this request. The caller must
 * pass the result to attachSessionCookie() on the response so a first-time
 * visitor receives their HttpOnly identity cookie.
 */
export function resolveAnonymousSession(req: NextRequest): AnonymousSession {
  const existing = readSessionToken(req);
  if (existing) {
    return { token: existing, hash: hashSessionToken(existing), isNew: false };
  }
  const token = createSessionToken();
  return { token, hash: hashSessionToken(token), isNew: true };
}

/** Set the cookie on the response when (and only when) it was just minted. */
export function attachSessionCookie(res: NextResponse, session: AnonymousSession): void {
  if (!session.isNew) return;
  res.cookies.set(FARTAK_SESSION_COOKIE, session.token, {
    httpOnly: true, // never readable from JavaScript
    secure: process.env.NODE_ENV === "production", // HTTPS-only outside dev
    sameSite: "lax", // cookie not sent on cross-site POSTs (CSRF)
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * Origin validation for state-changing endpoints. Same-origin embedding
 * (host site + module on one Next.js deployment) passes: browsers send
 * Origin on POST, and it must match the host the request arrived on.
 * Absent Origin (non-browser callers) is allowed — CSRF requires a browser,
 * and SameSite=Lax already blocks cross-site cookie transmission.
 */
export function isTrustedOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = (forwardedHost ? forwardedHost.split(",")[0] : req.headers.get("host"))?.trim();
  if (!host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
// Best-effort in-memory rate limiting (per server instance).
//
// LIMITATION (documented deliberately): buckets live in this process's memory.
// That is fine for development and single-instance deployments, but a
// multi-instance or serverless production deployment needs shared
// infrastructure (Redis / Upstash / platform WAF) for a global limit.
// No external dependency is introduced here to keep the module portable.
import type { NextRequest } from "next/server";
import { hashSessionToken, readSessionToken } from "./session";
import { serverConfig } from "./config";

const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) || { count: 0, reset: now + serverConfig.rateLimitWindowMs };
  if (now > bucket.reset) {
    bucket.count = 0;
    bucket.reset = now + serverConfig.rateLimitWindowMs;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  return bucket.count <= serverConfig.rateLimitMax;
}

/**
 * Rate-limit key: the server-minted anonymous session (HttpOnly cookie)
 * combined with the client IP. Both halves are required to rotate a bucket —
 * dropping the cookie alone, or forging X-Forwarded-For alone, does not reset
 * the limiter (unlike keying on a single spoofable header).
 */
export function rateKey(req: NextRequest): string {
  const token = readSessionToken(req);
  const session = token ? hashSessionToken(token).slice(0, 16) : "anon";
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return `${session}|${ip}`;
}
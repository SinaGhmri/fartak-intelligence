// Best-effort in-memory rate limiting (per server instance).
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

export function clientKey(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
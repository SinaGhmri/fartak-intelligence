import { FARTAK_CONFIG } from "./config";
import type {
  BriefConfirmResponse,
  ChatResponse,
  LeadResponse,
  ProjectBriefEdits,
} from "./types";

// Thin fetch client for the server endpoints. All AI provider access,
// RAG, and tool execution happen server-side; nothing sensitive reaches
// the browser.

export interface ChatRequest {
  conversationId?: string | null;
  message: string;
  intent?: string | null;
}

export interface LeadRequest {
  conversationId: string;
  name: string;
  phone: string;
  email?: string;
  preferredContactMethod: string;
  briefId?: string | null;
  briefUpdates?: ProjectBriefEdits | null;
  /**
   * Optional duplicate-request key (sent as X-Fartak-Idempotency-Key).
   * Duplicate protection only — never authentication; the anonymous
   * ownership session travels automatically in the HttpOnly cookie.
   */
  idempotencyKey?: string | null;
}

export interface BriefConfirmRequest {
  conversationId?: string | null;
  briefId: string;
  briefUpdates?: ProjectBriefEdits | null;
}

async function post<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    // The server mints an HttpOnly anonymous-session cookie on the first
    // request; same-origin fetch includes it automatically. No token is ever
    // handled by application code or exposed to components.
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export function fartakChat(payload: ChatRequest): Promise<ChatResponse> {
  return post<ChatResponse>(FARTAK_CONFIG.chatEndpoint, payload);
}

// Explicit final confirmation of the brief — required before any contact
// collection or handoff.
export function fartakConfirmBrief(payload: BriefConfirmRequest): Promise<BriefConfirmResponse> {
  return post<BriefConfirmResponse>(FARTAK_CONFIG.briefEndpoint, payload);
}

export function fartakLead(payload: LeadRequest): Promise<LeadResponse> {
  const headers: Record<string, string> = {};
  if (payload.idempotencyKey) headers["X-Fartak-Idempotency-Key"] = payload.idempotencyKey;
  return post<LeadResponse>(FARTAK_CONFIG.leadEndpoint, payload, headers);
}
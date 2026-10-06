import type { FartakAnalyticsHandler, FartakEvent } from "./types";

// Portable analytics layer.
//
// The host website connects in either of two ways:
//   1. Import and register a handler (recommended):
//        import { setFartakAnalytics } from "@/lib/fartak/analytics";
//        setFartakAnalytics((event, props) => myAnalytics.track(event, props));
//   2. Listen to the "fartak:analytics" window event (no import needed).

let handler: FartakAnalyticsHandler | null = null;

export function setFartakAnalytics(h: FartakAnalyticsHandler | null) {
  handler = h;
}

export function track(
  event: FartakEvent,
  properties?: Record<string, string | number | boolean | null>
) {
  try {
    handler?.(event, properties);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("fartak:analytics", { detail: { event, properties } })
      );
    }
  } catch {
    // Analytics must never break the AI experience.
  }
}

export const EVENTS = {
  AI_OPENED: "ai_opened",
  INTENT_SELECTED: "intent_selected",
  CONVERSATION_STARTED: "conversation_started",
  DISCOVERY_STARTED: "discovery_started",
  PROJECT_BRIEF_CREATED: "project_brief_created",
  PROJECT_BRIEF_GENERATED: "project_brief_generated",
  PROJECT_BRIEF_EDITED: "project_brief_edited",
  PROJECT_BRIEF_CONFIRMED: "project_brief_confirmed",
  CONTACT_FORM_STARTED: "contact_form_started",
  CONTACT_SUBMITTED: "contact_submitted",
  CONTACT_DECLINED: "contact_declined",
  PROJECT_HANDOFF_COMPLETED: "project_handoff_completed",
  LEAD_STARTED: "lead_started",
  LEAD_SUBMITTED: "lead_submitted",
  TOOL_USED: "tool_used",
  CONVERSATION_ERROR: "conversation_error",
} as const;
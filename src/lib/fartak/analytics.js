import { base44 } from "@/api/base44Client";

// Analytics events for Fartak Intelligence (spec: Phase 9).
export const EVENTS = {
  AI_OPENED: "ai_opened",
  INTENT_SELECTED: "intent_selected",
  CONVERSATION_STARTED: "conversation_started",
  PROJECT_BRIEF_CREATED: "project_brief_created",
  LEAD_STARTED: "lead_started",
  LEAD_SUBMITTED: "lead_submitted",
  TOOL_USED: "tool_used",
  CONVERSATION_ERROR: "conversation_error",
};

export function track(event, properties = {}) {
  try {
    base44.analytics.track({ eventName: event, properties });
  } catch {
    // analytics must never break the experience
  }
}
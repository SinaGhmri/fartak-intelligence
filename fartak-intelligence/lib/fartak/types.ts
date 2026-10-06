// Shared types for the Fartak Intelligence module.

export type Intent = "ai_product" | "web_app" | "mobile_app" | "automation" | "idea";

export type FartakPhase = "welcome" | "conversation";
export type FartakStatus = "idle" | "thinking" | "streaming" | "error";
// Handoff funnel: confirm (explicit brief confirmation) → form (contact
// collection, only AFTER confirmation) → success (project handoff completed).
export type LeadStage = null | "confirm" | "form" | "success";

export type ContactMethod = "phone" | "whatsapp" | "telegram" | "email";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  error?: boolean;
  actions?: AgentAction[];
}

export interface KnowledgeCard {
  id: string;
  ref_id: string;
  title: string;
  category: string;
  content: string;
  is_placeholder: boolean;
  tags: string[];
}

export type AgentAction =
  | { type: "show_project"; project: KnowledgeCard }
  | { type: "show_service"; service: KnowledgeCard }
  | { type: "project_brief"; brief: ProjectBrief }
  | { type: "navigate_to"; target: string };

// Internal project-readiness evaluation produced by the AI. Deliberately has
// NO numeric score — only whether the project has enough information for a
// meaningful handoff and what is still missing.
export interface ReadinessState {
  ready: boolean;
  missingCritical: string[];
  missingOptional: string[];
}

// Brief lifecycle states — ONE centralized representation, used by the wire
// type, the server state machine, and storage mapping. String-based on
// purpose: portable across databases (no Prisma enums).
export const BRIEF_STATUS = {
  DRAFT: "draft",
  REVIEW: "review",
  CONFIRMED: "confirmed",
  LOCKED: "locked",
} as const;

export type BriefStatus = (typeof BRIEF_STATUS)[keyof typeof BRIEF_STATUS];

export function isBriefStatus(value: unknown): value is BriefStatus {
  return (
    value === BRIEF_STATUS.DRAFT ||
    value === BRIEF_STATUS.REVIEW ||
    value === BRIEF_STATUS.CONFIRMED ||
    value === BRIEF_STATUS.LOCKED
  );
}

// Structured project brief. All fields except features are optional — the AI
// populates only what the visitor actually told it.
export interface ProjectBrief {
  id: string;
  conversation_id: string;
  project_name?: string;
  project_type?: string;
  problem?: string;
  goal?: string;
  target_users?: string;
  user_roles?: string;
  platform?: string;
  features: string[];
  workflows?: string;
  ai_requirements?: string;
  integrations?: string;
  constraints?: string;
  mvp_scope?: string;
  future_scope?: string;
  assumptions: string[];
  open_questions: string[];
  timeline?: string;
  budget?: string;
  geographic_scope?: string;
  languages?: string;
  security_privacy?: string;
  additional_notes?: string;
  readiness?: ReadinessState;
  status: BriefStatus;
}

// Editable fields on the brief (used by the review UI, confirmation, and lead
// submission). Readiness is an internal AI evaluation — never user-editable.
export type ProjectBriefEdits = Partial<
  Omit<ProjectBrief, "id" | "conversation_id" | "status" | "readiness">
>;

// Minimum contact information, collected only AFTER the brief is explicitly
// confirmed. Phone is required; email is required only when the visitor picks
// email as their preferred contact method.
export interface LeadData {
  name: string;
  phone: string;
  email?: string;
  preferredContactMethod: ContactMethod;
}

export interface ChatResponse {
  conversationId: string;
  message: string;
  actions: AgentAction[];
  brief: ProjectBrief | null;
  readiness?: ReadinessState | null;
}

export interface BriefConfirmResponse {
  ok: boolean;
  brief: ProjectBrief | null;
}

export interface LeadResponse {
  ok: boolean;
  leadId: string;
  projectReference: string;
  projectName: string | null;
  preferredContactMethod: ContactMethod;
}

// Final handoff summary shown on the success screen and exposed to the host.
export interface HandoffSummary {
  projectReference: string;
  projectName: string | null;
  preferredContactMethod: ContactMethod;
}

export type FartakEvent =
  | "ai_opened"
  | "intent_selected"
  | "conversation_started"
  | "discovery_started"
  | "project_brief_created"
  | "project_brief_generated"
  | "project_brief_edited"
  | "project_brief_confirmed"
  | "contact_form_started"
  | "contact_submitted"
  | "contact_declined"
  | "project_handoff_completed"
  | "lead_started"
  | "lead_submitted"
  | "tool_used"
  | "conversation_error";

export type FartakAnalyticsHandler = (
  event: FartakEvent,
  properties?: Record<string, string | number | boolean | null>
) => void;
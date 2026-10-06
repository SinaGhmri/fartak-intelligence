"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { fartakChat, fartakLead, fartakConfirmBrief } from "../lib/fartak/apiClient";
import type { LeadRequest } from "../lib/fartak/apiClient";
import { track, EVENTS } from "../lib/fartak/analytics";
import type {
  AgentAction,
  ChatMessage,
  FartakPhase,
  FartakStatus,
  HandoffSummary,
  Intent,
  LeadData,
  LeadStage,
  ProjectBrief,
  ProjectBriefEdits,
} from "../lib/fartak/types";

let idCounter = 0;
const uid = () => `m${Date.now()}_${idCounter++}`;

// One idempotency key per contact-form attempt (stable across retries and
// double-clicks of the same submission). Not a secret — just a duplicate
// marker; server-side ownership comes from the session cookie.
const newIdempotencyKey = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export interface UseFartakAIOptions {
  // Fired after the server completes the project handoff.
  onLeadSubmitted?: (leadId: string, reference: string) => void;
}

// State machine for the Fartak Intelligence experience.
// phase:     "welcome" (no messages yet) | "conversation"
// status:    "idle" | "thinking" | "streaming" | "error"
// leadStage: null | "confirm" (explicit brief confirmation) | "form"
//            (contact collection — only AFTER confirmation) | "success"
export function useFartakAI(options: UseFartakAIOptions = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [status, setStatus] = useState<FartakStatus>("idle");
  const [brief, setBrief] = useState<ProjectBrief | null>(null);
  const [briefEdits, setBriefEdits] = useState<ProjectBriefEdits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leadStage, setLeadStage] = useState<LeadStage>(null);
  const [handoff, setHandoff] = useState<HandoffSummary | null>(null);
  const streamTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);
  const discoveryStartedRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (streamTimer.current) clearInterval(streamTimer.current);
    },
    []
  );

  const open = useCallback(() => {
    setIsOpen(true);
    setIsOpening(true);
    track(EVENTS.AI_OPENED);
    setTimeout(() => setIsOpening(false), 650);
  }, []);

  // Closing the panel preserves all conversation state.
  const close = useCallback(() => {
    setIsOpen(false);
    if (streamTimer.current) {
      clearInterval(streamTimer.current);
      streamTimer.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setIntent(null);
    setStatus("idle");
    setBrief(null);
    setBriefEdits(null);
    setError(null);
    setLeadStage(null);
    setHandoff(null);
    startedRef.current = false;
    discoveryStartedRef.current = false;
    idempotencyKeyRef.current = null;
  }, []);

  const phase: FartakPhase = messages.length === 0 ? "welcome" : "conversation";

  const streamText = useCallback((msgId: string, fullText: string, onDone?: () => void) => {
    if (streamTimer.current) clearInterval(streamTimer.current);
    const step = Math.max(2, Math.round(fullText.length / 50));
    let i = 0;
    streamTimer.current = setInterval(() => {
      i += step;
      const partial = fullText.slice(0, i);
      const done = i >= fullText.length;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, content: partial, streaming: !done } : m
        )
      );
      if (done) {
        if (streamTimer.current) clearInterval(streamTimer.current);
        streamTimer.current = null;
        onDone?.();
      }
    }, 18);
  }, []);

  const sendMessage = useCallback(
    async (text: string, selectedIntent?: Intent) => {
      const content = (text || "").trim();
      if (!content || status === "thinking" || status === "streaming") return;
      setError(null);

      if (selectedIntent) {
        setIntent(selectedIntent);
        track(EVENTS.INTENT_SELECTED, { intent: selectedIntent });
      }

      setMessages((prev) => [...prev, { id: uid(), role: "user", content }]);
      if (!startedRef.current) {
        startedRef.current = true;
        track(EVENTS.CONVERSATION_STARTED);
      }

      setStatus("thinking");
      const thinkingId = uid();
      setMessages((prev) => [
        ...prev,
        { id: thinkingId, role: "assistant", content: "", streaming: true, actions: [] },
      ]);

      try {
        const data = await fartakChat({
          conversationId,
          message: content,
          intent: selectedIntent || intent,
        });
        if (data.conversationId) setConversationId(data.conversationId);

        const reply = data.message || "";
        const actions: AgentAction[] = data.actions || [];
        const newBrief =
          data.brief ||
          (actions.find((a) => a.type === "project_brief") as { brief: ProjectBrief } | undefined)
            ?.brief ||
          null;

        setMessages((prev) => prev.map((m) => (m.id === thinkingId ? { ...m, actions } : m)));
        if (newBrief) {
          setBrief(newBrief);
          setBriefEdits(null);
          track(EVENTS.PROJECT_BRIEF_GENERATED, { briefId: newBrief.id });
        }
        actions.forEach((a) => track(EVENTS.TOOL_USED, { tool: a.type }));

        if (!discoveryStartedRef.current) {
          discoveryStartedRef.current = true;
          track(EVENTS.DISCOVERY_STARTED);
        }

        setStatus("streaming");
        streamText(thinkingId, reply, () => setStatus("idle"));
      } catch (e) {
        setStatus("error");
        const msg = e instanceof Error ? e.message : "Something went wrong";
        setError(msg);
        track(EVENTS.CONVERSATION_ERROR, { message: msg });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === thinkingId ? { ...m, content: "", streaming: false, error: true } : m
          )
        );
      }
    },
    [conversationId, intent, status, streamText]
  );

  const retry = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    setMessages((prev) => prev.filter((m) => !(m.role === "assistant" && m.error)));
    setStatus("idle");
    if (lastUser) sendMessage(lastUser.content);
  }, [messages, sendMessage]);

  // Visitor edited the brief during review. Funnel event, edits kept for the
  // confirmation + handoff submissions.
  const editBrief = useCallback((edits: ProjectBriefEdits) => {
    setBriefEdits(edits);
    track(EVENTS.PROJECT_BRIEF_EDITED);
  }, []);

  // Step 1 of the handoff: open the explicit confirmation step. No contact
  // collection is ever triggered before this.
  const startConfirmation = useCallback(() => {
    setLeadStage("confirm");
  }, []);

  // Step 2: the visitor explicitly confirmed the brief. Applies their edits
  // server-side and only then unlocks the contact form.
  const confirmBrief = useCallback(async () => {
    if (!brief) throw new Error("No brief to confirm");
    const res = await fartakConfirmBrief({
      conversationId,
      briefId: brief.id,
      briefUpdates: briefEdits,
    });
    if (!res.ok || !res.brief) throw new Error("Confirmation failed");
    setBrief(res.brief);
    track(EVENTS.PROJECT_BRIEF_CONFIRMED, { briefId: brief.id });
    setLeadStage("form");
    track(EVENTS.CONTACT_FORM_STARTED);
  }, [brief, briefEdits, conversationId]);

  // The visitor declines to share contact details: no pressure, no restart —
  // the completed brief stays visible and available.
  const declineContact = useCallback(() => {
    setLeadStage(null);
    track(EVENTS.CONTACT_DECLINED);
  }, []);

  // Step 3: contact submission completes the project handoff.
  const submitLead = useCallback(
    async (leadData: LeadData) => {
      try {
        // Stable per form attempt: retries/double-clicks repeat the same key
        // so the server can collapse duplicates (alongside its unique
        // conversation constraint). The ownership session itself is handled
        // automatically via the HttpOnly cookie — never by this hook.
        if (!idempotencyKeyRef.current) idempotencyKeyRef.current = newIdempotencyKey();
        const payload: LeadRequest = {
          conversationId: conversationId as string,
          name: leadData.name,
          phone: leadData.phone,
          email: leadData.email || undefined,
          preferredContactMethod: leadData.preferredContactMethod,
          briefId: brief?.id ?? null,
          briefUpdates: briefEdits,
          idempotencyKey: idempotencyKeyRef.current,
        };
        const data = await fartakLead(payload);
        if (data.ok) {
          setHandoff({
            projectReference: data.projectReference,
            projectName: data.projectName,
            preferredContactMethod: data.preferredContactMethod,
          });
          setLeadStage("success");
          track(EVENTS.CONTACT_SUBMITTED, { leadId: data.leadId });
          track(EVENTS.PROJECT_HANDOFF_COMPLETED, {
            leadId: data.leadId,
            reference: data.projectReference,
          });
          options.onLeadSubmitted?.(data.leadId, data.projectReference);
          return true;
        }
        throw new Error("Submission failed");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Submission failed";
        setError(msg);
        track(EVENTS.CONVERSATION_ERROR, { message: msg });
        throw e;
      }
    },
    [conversationId, brief, briefEdits, options]
  );

  return {
    isOpen,
    isOpening,
    open,
    close,
    reset,
    messages,
    phase,
    status,
    intent,
    brief,
    briefEdits,
    error,
    leadStage,
    handoff,
    sendMessage,
    retry,
    editBrief,
    startConfirmation,
    confirmBrief,
    declineContact,
    submitLead,
    setBrief,
    setLeadStage,
  };
}
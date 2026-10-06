import { useState, useCallback, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { track, EVENTS } from "./analytics";

let idCounter = 0;
const uid = () => `m${Date.now()}_${idCounter++}`;

// State machine for the Fartak Intelligence experience.
// phase:  "welcome" (no messages yet) | "conversation"
// status: "idle" | "thinking" | "streaming" | "error"
// leadStage: null | "form" | "success"
export function useFartakAI() {
  const [isOpen, setIsOpen] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [intent, setIntent] = useState(null);
  const [status, setStatus] = useState("idle");
  const [brief, setBrief] = useState(null);
  const [error, setError] = useState(null);
  const [leadStage, setLeadStage] = useState(null);
  const streamTimer = useRef(null);
  const startedRef = useRef(false);

  useEffect(() => () => {
    if (streamTimer.current) clearInterval(streamTimer.current);
  }, []);

  const open = useCallback(() => {
    setIsOpen(true);
    setIsOpening(true);
    track(EVENTS.AI_OPENED);
    setTimeout(() => setIsOpening(false), 650);
  }, []);

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
    setError(null);
    setLeadStage(null);
    startedRef.current = false;
  }, []);

  const phase = messages.length === 0 ? "welcome" : "conversation";

  const streamText = useCallback((msgId, fullText, onDone) => {
    if (streamTimer.current) clearInterval(streamTimer.current);
    const step = Math.max(2, Math.round(fullText.length / 50));
    let i = 0;
    streamTimer.current = setInterval(() => {
      i += step;
      const partial = fullText.slice(0, i);
      const done = i >= fullText.length;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, content: done ? fullText : partial, streaming: !done } : m
        )
      );
      if (done) {
        clearInterval(streamTimer.current);
        streamTimer.current = null;
        onDone && onDone();
      }
    }, 18);
  }, []);

  const sendMessage = useCallback(
    async (text, selectedIntent) => {
      const content = (text || "").trim();
      if (!content || status === "thinking" || status === "streaming") return;
      setError(null);

      const userIntent = selectedIntent || intent;
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
        const res = await base44.functions.invoke("aiChat", {
          conversationId,
          message: content,
          intent: userIntent,
        });
        const data = res.data || res;
        if (data.conversationId) setConversationId(data.conversationId);

        const reply = data.message || "";
        const actions = data.actions || [];
        const newBrief =
          data.brief || (actions.find((a) => a.type === "project_brief") && actions.find((a) => a.type === "project_brief").brief) || null;

        setMessages((prev) =>
          prev.map((m) => (m.id === thinkingId ? { ...m, actions } : m))
        );
        if (newBrief) {
          setBrief(newBrief);
          track(EVENTS.PROJECT_BRIEF_CREATED, { briefId: newBrief.id });
        }
        actions.forEach((a) => track(EVENTS.TOOL_USED, { tool: a.type }));

        setStatus("streaming");
        streamText(thinkingId, reply, () => setStatus("idle"));
      } catch (e) {
        setStatus("error");
        const msg = e?.message || "Something went wrong";
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

  const startLead = useCallback(() => {
    setLeadStage("form");
    track(EVENTS.LEAD_STARTED);
  }, []);

  const submitLead = useCallback(
    async (leadData, briefUpdates) => {
      try {
        const res = await base44.functions.invoke("aiChat", {
          action: "submit_lead",
          conversationId,
          project_brief_id: brief?.id,
          brief_updates: briefUpdates,
          ...leadData,
        });
        const data = res.data || res;
        if (data.ok) {
          setLeadStage("success");
          track(EVENTS.LEAD_SUBMITTED, { leadId: data.leadId });
          return true;
        }
        throw new Error(data.error || "Submission failed");
      } catch (e) {
        const msg = e?.message || "Submission failed";
        setError(msg);
        track(EVENTS.CONVERSATION_ERROR, { message: msg });
        throw e;
      }
    },
    [conversationId, brief]
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
    error,
    leadStage,
    sendMessage,
    retry,
    startLead,
    submitLead,
    setBrief,
    setLeadStage,
  };
}
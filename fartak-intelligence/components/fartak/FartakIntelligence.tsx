"use client";

import { useEffect, useRef } from "react";
import AIOrb from "./AIOrb";
import AIExperience from "./AIExperience";
import { useFartakAI } from "../../hooks/useFartakAI";
import { FARTAK_CONFIG } from "../../lib/fartak/config";

// ── The host integration API ──────────────────────────────────────────────
// Mount once in the root layout (or any client wrapper):
//
//   <FartakIntelligence
//     onNavigate={(target) => router.push(`/#${target}`)}   // optional
//     onLeadSubmitted={(leadId, reference) => syncCRM(leadId, reference)} // optional
//   />
//
// The host website controls navigation. Without onNavigate, the default is to
// smooth-scroll to an element with the target's id (or to the top for "home").
// Any host button can also open the concierge via openFartak() (lib/fartak/bridge).
export default function FartakIntelligence({
  onNavigate,
  onLeadSubmitted,
  position = "global",
  mode = "floating",
}: {
  onNavigate?: (target: string) => void;
  /** Fired when the project handoff completes (after explicit confirmation). */
  onLeadSubmitted?: (leadId: string, projectReference: string) => void;
  /** Reserved for future layouts; only "global" is currently supported. */
  position?: "global";
  /** Reserved for future entry styles; only "floating" is currently supported. */
  mode?: "floating";
}) {
  const ai = useFartakAI({ onLeadSubmitted });
  const handledRef = useRef<Set<string>>(new Set());

  // Interpret navigate_to actions from the latest assistant message —
  // the AI can only request approved targets, never touch the DOM or URLs.
  useEffect(() => {
    if (!ai.messages.length) return;
    const last = ai.messages[ai.messages.length - 1];
    if (!last || last.role !== "assistant" || !last.actions) return;
    for (const action of last.actions) {
      if (action.type !== "navigate_to" || !FARTAK_CONFIG.features.navigation) continue;
      const key = `${action.target}-${last.id}`;
      if (handledRef.current.has(key)) continue;
      handledRef.current.add(key);
      if (onNavigate) onNavigate(action.target);
      else defaultNavigate(action.target);
    }
  }, [ai.messages, onNavigate]);

  // Bridge: any host button can open the concierge (see lib/fartak/bridge.ts).
  useEffect(() => {
    const onBridgeOpen = () => ai.open();
    window.addEventListener("fartak:open", onBridgeOpen);
    return () => window.removeEventListener("fartak:open", onBridgeOpen);
  }, [ai.open]);

  return (
    <>
      <AIOrb open={ai.open} isOpen={ai.isOpen} />
      <AIExperience ai={ai} />
    </>
  );
}

function defaultNavigate(target: string) {
  if (target === "home") {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const el = document.getElementById(target);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  else window.scrollTo({ top: 0, behavior: "smooth" });
}
import { useEffect, useRef } from "react";
import AIOrb from "./AIOrb";
import AIExperience from "./AIExperience";
import { useFartakAI } from "@/lib/fartak/useFartakAI";

// Global Fartak Intelligence overlay: the AI Orb entry point + the experience
// panel, mounted once and available on every page. Controlled website
// navigation (navigate_to tool actions) is interpreted here — the AI can only
// request approved section scrolls, never touch the DOM or arbitrary URLs.
// Reusable embedded AI module. Mount once in the app root (or any layout):
//   <FartakIntelligence />                              // defaults
//   <FartakIntelligence position="global" mode="floating" />
// Only mode="floating" is supported; position is reserved for future layouts.
export default function FartakIntelligence({ position = "global", mode = "floating" }) {
  const ai = useFartakAI();
  const handledRef = useRef(new Set());

  // Website buttons (hero, header, contact CTAs) open the concierge through
  // the bridge event — the site never needs to own the AI state.
  useEffect(() => {
    const onBridgeOpen = () => ai.open();
    window.addEventListener("fartak:open", onBridgeOpen);
    return () => window.removeEventListener("fartak:open", onBridgeOpen);
  }, [ai.open]);

  // Interpret navigate_to actions from the latest assistant message.
  useEffect(() => {
    if (!ai.messages.length) return;
    const last = ai.messages[ai.messages.length - 1];
    if (!last || last.role !== "assistant" || !last.actions) return;
    for (const action of last.actions) {
      if (action.type === "navigate_to" && !handledRef.current.has(action._navKey || (action._navKey = `${action.target}-${last.id}`))) {
        handledRef.current.add(action._navKey);
        const target = action.target;
        if (target === "home") {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          const el = document.getElementById(target);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        }
      }
    }
  }, [ai.messages]);

  return (
    <>
      <AIOrb open={ai.open} isOpen={ai.isOpen} />
      <AIExperience ai={ai} />
    </>
  );
}
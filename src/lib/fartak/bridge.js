// Bridge between the existing website and the embedded Fartak Intelligence
// module. Any site button can open the concierge without owning its state:
//
//   import { openFartak } from "@/lib/fartak/bridge";
//   <button onClick={openFartak}>Talk to Fartak Intelligence</button>
//
// The globally mounted <FartakIntelligence /> listens for this event.

export function openFartak() {
  window.dispatchEvent(new CustomEvent("fartak:open"));
}
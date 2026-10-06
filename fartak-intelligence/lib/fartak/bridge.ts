// Open the concierge from anywhere in the host website.
//   import { openFartak } from "@/lib/fartak/bridge";
//   <button onClick={openFartak}>Talk to our AI</button>
export function openFartak() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("fartak:open"));
  }
}
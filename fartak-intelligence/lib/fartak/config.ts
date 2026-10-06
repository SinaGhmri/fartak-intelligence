// Configuration layer for the host website. Nothing environment-specific is
// hard-coded: the host patches these values at module init (or passes props
// to <FartakIntelligence />).

import type { ContactMethod } from "./types";

export interface FartakConfig {
  // Shown in the AI panel header + success copy.
  companyLabel: string;
  // Server endpoints (Next.js App Router route handlers by default).
  chatEndpoint: string;
  briefEndpoint: string;
  leadEndpoint: string;
  // Navigation targets the AI may request via navigate_to. The host decides
  // what these mean (see the onNavigate prop on <FartakIntelligence />).
  navTargets: string[];
  // Contact methods the company actually supports. Only these are offered to
  // the visitor as their preferred contact method.
  contactMethods: ContactMethod[];
  // Feature flags — disable a subsystem without touching code.
  features: {
    navigation: boolean;
    brief: boolean;
    lead: boolean;
  };
}

export const FARTAK_CONFIG: FartakConfig = {
  companyLabel: "Puyesh Fartak Sina",
  chatEndpoint: "/api/fartak/chat",
  briefEndpoint: "/api/fartak/brief",
  leadEndpoint: "/api/fartak/lead",
  navTargets: ["home", "about", "services", "projects", "process", "contact"],
  contactMethods: ["phone", "whatsapp", "telegram", "email"],
  features: { navigation: true, brief: true, lead: true },
};

export function configureFartak(patch: Partial<FartakConfig>) {
  Object.assign(FARTAK_CONFIG, patch);
}
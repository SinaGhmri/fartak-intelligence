import { Sparkles, Globe, Smartphone, Workflow, Lightbulb } from "lucide-react";

// ── Single source of truth ────────────────────────────────────────────────
// Verified company data for Puyesh Fartak Sina. The website sections render
// from this module, and the AI Knowledge Base records mirror it (same
// ref_ids) so the concierge and the site never diverge. Anything not yet
// confirmed by the company carries is_placeholder: true — the AI must never
// present placeholder content as a verified company fact.

export const COMPANY = {
  name: "Puyesh Fartak Sina",
  heroTitle: "Software that starts with your idea.",
  heroSubtitle:
    "Puyesh Fartak Sina builds web, mobile, automation and AI products. This site's embedded AI concierge — Fartak Intelligence — shapes your idea into a structured project brief before you ever fill a form.",
};

export const ABOUT = {
  heading: "About Puyesh Fartak Sina",
  body: "Puyesh Fartak Sina is the company behind Fartak Intelligence — the AI concierge embedded in this website. We work across web applications, mobile apps, automation and AI-powered products.",
  placeholderNote:
    "A verified company overview — founding story, team and track record — will appear here once confirmed content is available.",
};

export const SERVICES = [
  {
    ref_id: "service-ai-product",
    icon: Sparkles,
    label: "AI Products",
    description: "AI-powered products — from concept to working system, with intelligence at the core.",
  },
  {
    ref_id: "service-web-app",
    icon: Globe,
    label: "Web Applications",
    description: "Custom web applications built around your users and your workflow.",
  },
  {
    ref_id: "service-mobile-app",
    icon: Smartphone,
    label: "Mobile Applications",
    description: "iOS and Android apps, designed and engineered end to end.",
  },
  {
    ref_id: "service-automation",
    icon: Workflow,
    label: "Automation",
    description: "Process and workflow automation that removes repetitive work.",
  },
  {
    ref_id: "service-custom-idea",
    icon: Lightbulb,
    label: "Custom & New Ideas",
    description: "Something new — we help shape it into a buildable product.",
  },
];

export const PROJECTS = {
  heading: "Selected work",
  placeholderNote: "Awaiting verified project case studies from Puyesh Fartak Sina.",
};

export const PROCESS_STEPS = [
  { n: "01", t: "Describe", d: "Start with Fartak Intelligence — describe what you want to build in your own words." },
  { n: "02", t: "Discover", d: "The concierge asks adaptive questions, never repeating what you already told it." },
  { n: "03", t: "Brief", d: "You get a structured, editable project brief: goal, users, platform, features." },
  { n: "04", t: "Connect", d: "Submit it as a lead. The team follows up with the full context of your conversation." },
];

export const CONTACT = {
  heading: "Start with a conversation",
  body: "The fastest way to reach the team is through Fartak Intelligence — open the concierge, describe your idea, and submit your brief. We follow up with the full context of your conversation.",
  placeholderNote: "Verified direct contact details will be published here once confirmed.",
};
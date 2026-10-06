import { Sparkles, Globe, Smartphone, Workflow, Lightbulb } from "lucide-react";

export const INTENTS = [
  { id: "ai_product", label: "AI Product", icon: Sparkles, description: "An AI-powered product" },
  { id: "web_app", label: "Web App", icon: Globe, description: "A web application" },
  { id: "mobile_app", label: "Mobile App", icon: Smartphone, description: "iOS / Android app" },
  { id: "automation", label: "Automation", icon: Workflow, description: "Automate a process" },
  { id: "idea", label: "I Have an Idea", icon: Lightbulb, description: "Something new" },
];

export const SUGGESTION_CHIPS = [
  "Show me your AI services",
  "Show me your projects",
  "I want to build an AI healthcare platform",
  "How does this work?",
];

// Approved navigation targets -> real on-page section ids of the company
// website (controlled site navigation; must match the sections rendered by
// src/components/site/*).
export const NAV_SECTIONS = ["home", "about", "services", "projects", "process", "contact"];
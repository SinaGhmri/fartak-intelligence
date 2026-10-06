import { Sparkles, Globe, Smartphone, Workflow, Lightbulb } from "lucide-react";
import type { Intent } from "./types";

// Intent selection options (the "What are you building?" surface).
export const INTENTS: { id: Intent; label: string; description: string; icon: typeof Sparkles }[] = [
  { id: "ai_product", label: "AI Product", description: "An AI-powered product", icon: Sparkles },
  { id: "web_app", label: "Web App", description: "A web application", icon: Globe },
  { id: "mobile_app", label: "Mobile App", description: "iOS / Android app", icon: Smartphone },
  { id: "automation", label: "Automation", description: "Automate a process", icon: Workflow },
  { id: "idea", label: "I Have an Idea", description: "Something new", icon: Lightbulb },
];

// Welcome-screen suggestion chips.
export const SUGGESTION_CHIPS = [
  "Show me your AI services",
  "Show me your projects",
  "I want to build an AI healthcare platform",
  "How does this work?",
];
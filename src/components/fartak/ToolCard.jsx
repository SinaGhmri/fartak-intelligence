import { motion } from "framer-motion";
import { FolderKanban, Wrench, MapPin, ArrowUpRight } from "lucide-react";

// Renders an AI tool action as an interactive card (AI-native, not just text).
// Supported actions: show_project, show_service, navigate_to, project_brief.
export default function ToolCard({ action, onLead }) {
  if (!action) return null;

  if (action.type === "show_project" || action.type === "show_service") {
    const item = action.project || action.service || {};
    const isProject = action.type === "show_project";
    const Icon = isProject ? FolderKanban : Wrench;
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-3.5 shadow-sm"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-cyan-300">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {isProject ? "Project" : "Service"}
            </p>
            <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
          </div>
        </div>
        <p className="mt-2.5 text-sm leading-relaxed text-slate-600">{item.content}</p>
        {item.is_placeholder && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
            Awaiting verified content from Puyesh Fartak Sina
          </p>
        )}
      </motion.div>
    );
  }

  if (action.type === "navigate_to") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-center gap-2.5 rounded-xl border border-cyan-200 bg-cyan-50/60 px-3 py-2.5"
      >
        <MapPin className="h-4 w-4 text-cyan-700" />
        <span className="text-sm text-cyan-900">
          Taking you to <span className="font-semibold capitalize">{action.target}</span>
        </span>
      </motion.div>
    );
  }

  if (action.type === "project_brief") {
    return null; // brief is rendered by ProjectBriefCard at the panel level
  }

  return null;
}
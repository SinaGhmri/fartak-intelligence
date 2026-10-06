"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { FileText, Pencil, Check, ArrowRight } from "lucide-react";
import type { ProjectBrief, ProjectBriefEdits } from "../../lib/fartak/types";

// Editable Project Brief. The visitor reviews and can edit before submitting
// as a lead. Edits are passed back on submission. Confirmed fields, assumptions
// and open questions are shown distinctly — the AI never turns guesses into
// confirmed requirements.

const FIELDS: { key: keyof ProjectBriefEdits; label: string }[] = [
  { key: "project_name", label: "Project" },
  { key: "project_type", label: "Project Type" },
  { key: "problem", label: "Problem" },
  { key: "goal", label: "Proposed Solution" },
  { key: "target_users", label: "Target Users" },
  { key: "user_roles", label: "User Roles" },
  { key: "platform", label: "Platform" },
  { key: "workflows", label: "Main Workflows" },
  { key: "ai_requirements", label: "AI Requirements" },
  { key: "integrations", label: "Integrations" },
  { key: "constraints", label: "Constraints" },
  { key: "mvp_scope", label: "MVP Scope" },
  { key: "future_scope", label: "Future Scope" },
  { key: "timeline", label: "Timeline" },
  { key: "budget", label: "Budget" },
  { key: "geographic_scope", label: "Geographic Scope" },
  { key: "languages", label: "Languages" },
  { key: "security_privacy", label: "Security & Privacy" },
  { key: "additional_notes", label: "Notes" },
];

function normalizeBrief(brief: ProjectBrief): ProjectBriefEdits {
  return {
    ...brief,
    features: Array.isArray(brief.features) ? brief.features : [],
    assumptions: Array.isArray(brief.assumptions) ? brief.assumptions : [],
    open_questions: Array.isArray(brief.open_questions) ? brief.open_questions : [],
  };
}

// One editable string list (features / assumptions / open questions).
function EditableList({
  label,
  items,
  editing,
  onChange,
  addLabel,
  dotClass,
}: {
  label: string;
  items: string[];
  editing: boolean;
  onChange: (items: string[]) => void;
  addLabel: string;
  dotClass: string;
}) {
  const setItem = (idx: number, value: string) => {
    const next = [...items];
    next[idx] = value;
    onChange(next);
  };
  const removeItem = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="flex flex-col gap-1.5">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            {editing ? (
              <>
                <input
                  value={item}
                  onChange={(e) => setItem(idx, e.target.value)}
                  className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-cyan-400 focus:bg-white"
                />
                <button onClick={() => removeItem(idx)} className="text-xs text-slate-400 hover:text-red-500">
                  ✕
                </button>
              </>
            ) : (
              <span className="flex items-center gap-1.5 text-sm text-slate-800">
                <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
                {item || <span className="text-slate-300">—</span>}
              </span>
            )}
          </div>
        ))}
        {editing && (
          <button onClick={() => onChange([...items, ""])} className="self-start text-xs font-medium text-cyan-700 hover:underline">
            {addLabel}
          </button>
        )}
        {!editing && items.length === 0 && <span className="text-sm text-slate-300">—</span>}
      </dd>
    </div>
  );
}

export default function ProjectBriefCard({
  brief,
  onEdit,
  onConfirm,
  confirmLabel = "Review & confirm",
  disabled,
}: {
  brief: ProjectBrief;
  onEdit: (edits: ProjectBriefEdits) => void;
  onConfirm: () => void;
  confirmLabel?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProjectBriefEdits>(normalizeBrief(brief));

  // Re-sync the editable draft whenever a NEW brief is generated.
  useEffect(() => {
    setDraft(normalizeBrief(brief));
  }, [brief]);

  const setField = (key: keyof ProjectBriefEdits, value: string | string[]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onEdit(next);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_40px_-20px_rgba(8,145,178,0.5)]"
    >
      <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-slate-900 to-cyan-800 px-4 py-3">
        <div className="flex items-center gap-2 text-white">
          <FileText className="h-4 w-4" />
          <span className="text-sm font-semibold tracking-wide">PROJECT BRIEF</span>
        </div>
        <button
          onClick={() => setEditing((e) => !e)}
          className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-xs font-medium text-white hover:bg-white/20"
        >
          {editing ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      <div className="max-h-[40vh] overflow-y-auto px-4 py-3">
        <dl className="flex flex-col gap-2.5">
          {FIELDS.map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-0.5">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
              {editing ? (
                <textarea
                  value={(draft[key] as string) || ""}
                  onChange={(e) => setField(key, e.target.value)}
                  rows={1}
                  className="resize-none rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-cyan-400 focus:bg-white"
                />
              ) : (
                <dd className="text-sm text-slate-800">
                  {(draft[key] as string) || <span className="text-slate-300">—</span>}
                </dd>
              )}
            </div>
          ))}

          <EditableList
            label="Core Features (confirmed)"
            items={draft.features || []}
            editing={editing}
            onChange={(items) => setField("features", items)}
            addLabel="+ Add feature"
            dotClass="bg-cyan-500"
          />
          <EditableList
            label="Assumptions (not yet confirmed)"
            items={draft.assumptions || []}
            editing={editing}
            onChange={(items) => setField("assumptions", items)}
            addLabel="+ Add assumption"
            dotClass="bg-amber-400"
          />
          <EditableList
            label="Open Questions"
            items={draft.open_questions || []}
            editing={editing}
            onChange={(items) => setField("open_questions", items)}
            addLabel="+ Add question"
            dotClass="bg-rose-400"
          />
        </dl>
      </div>

      <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
        <button
          onClick={onConfirm}
          disabled={disabled}
          className="group flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
        >
          {confirmLabel}
          <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </button>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          Review the brief — cyan items are confirmed, amber items are assumptions. Nothing is sent until you explicitly confirm.
        </p>
      </div>
    </motion.div>
  );
}
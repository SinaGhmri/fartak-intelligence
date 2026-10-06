import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { FileText, Pencil, Check, ArrowRight } from "lucide-react";

// Polished, editable Project Brief. The visitor reviews and can edit before
// submitting as a lead. Edits are passed back on submission. Confirmed fields,
// assumptions and open questions are shown distinctly — the AI never turns
// guesses into confirmed requirements.

const FIELDS = [
  { key: "project_name", label: "Project" },
  { key: "problem", label: "Problem" },
  { key: "goal", label: "Goal" },
  { key: "target_users", label: "Target Users" },
  { key: "user_roles", label: "User Roles" },
  { key: "platform", label: "Platform" },
  { key: "workflows", label: "Main Workflows" },
  { key: "ai_requirements", label: "AI Requirements" },
  { key: "integrations", label: "Integrations" },
  { key: "stage", label: "Stage" },
  { key: "mvp_scope", label: "MVP Scope" },
  { key: "future_scope", label: "Future Scope" },
  { key: "timeline", label: "Timeline" },
  { key: "notes", label: "Notes" },
];

const LISTS = [
  { key: "features", label: "Core Features (confirmed)", addLabel: "+ Add feature", dotClass: "bg-cyan-500" },
  { key: "assumptions", label: "Assumptions (not yet confirmed)", addLabel: "+ Add assumption", dotClass: "bg-amber-400" },
  { key: "open_questions", label: "Open Questions", addLabel: "+ Add question", dotClass: "bg-rose-400" },
];

function normalizeBrief(brief) {
  return {
    ...brief,
    features: Array.isArray(brief.features) ? brief.features : [],
    assumptions: Array.isArray(brief.assumptions) ? brief.assumptions : [],
    open_questions: Array.isArray(brief.open_questions) ? brief.open_questions : [],
  };
}

export default function ProjectBriefCard({ brief, onEdit, onSubmit, disabled }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(normalizeBrief(brief));

  // Re-sync the editable draft whenever a NEW brief is generated.
  useEffect(() => {
    setDraft(normalizeBrief(brief));
  }, [brief]);

  const setField = (key, value) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onEdit && onEdit(next);
  };

  const setListItem = (key, idx, value) => {
    const items = [...draft[key]];
    items[idx] = value;
    setField(key, items);
  };
  const addListItem = (key) => setField(key, [...draft[key], ""]);
  const removeListItem = (key, idx) => setField(key, draft[key].filter((_, i) => i !== idx));

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-slate-200 bg-white shadow-[0_12px_40px_-20px_rgba(8,145,178,0.5)] overflow-hidden"
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
                  value={draft[key] || ""}
                  onChange={(e) => setField(key, e.target.value)}
                  rows={1}
                  className="resize-none rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-cyan-400 focus:bg-white"
                />
              ) : (
                <dd className="text-sm text-slate-800">{draft[key] || <span className="text-slate-300">—</span>}</dd>
              )}
            </div>
          ))}

          {LISTS.map(({ key, label, addLabel, dotClass }) => (
            <div key={key} className="flex flex-col gap-1">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
              <dd className="flex flex-col gap-1.5">
                {draft[key].map((item, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    {editing ? (
                      <>
                        <input
                          value={item}
                          onChange={(e) => setListItem(key, idx, e.target.value)}
                          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-cyan-400 focus:bg-white"
                        />
                        <button onClick={() => removeListItem(key, idx)} className="text-xs text-slate-400 hover:text-red-500">✕</button>
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
                  <button onClick={() => addListItem(key)} className="self-start text-xs font-medium text-cyan-700 hover:underline">
                    {addLabel}
                  </button>
                )}
                {!editing && draft[key].length === 0 && <span className="text-sm text-slate-300">—</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
        <button
          onClick={onSubmit}
          disabled={disabled}
          className="group flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
        >
          Submit as lead
          <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </button>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          Review the brief — cyan items are confirmed, amber items are assumptions. We'll only contact you after you confirm.
        </p>
      </div>
    </motion.div>
  );
}
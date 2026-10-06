import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RotateCcw, CheckCircle2, Sparkles } from "lucide-react";
import IntentCards from "./IntentCards";
import ConversationView from "./ConversationView";
import ProjectBriefCard from "./ProjectBriefCard";
import LeadForm from "./LeadForm";

// The AI Experience panel — the full state machine surface.
// States: closed (orb only) -> opening -> welcome (intent) -> asking/thinking/
// streaming/result (conversation) -> project brief -> lead form -> success/error.
export default function AIExperience({ ai, onNavigate }) {
  const { isOpen, isOpening, close, reset, messages, phase, status, intent, brief, error, leadStage, sendMessage, retry, startLead, submitLead } = ai;
  const [briefEdits, setBriefEdits] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [leadError, setLeadError] = useState(null);

  // Reset ephemeral state when the brief changes.
  useEffect(() => {
    setBriefEdits(brief ? { ...brief, features: Array.isArray(brief.features) ? brief.features : [] } : null);
    setLeadError(null);
  }, [brief]);

  const handleIntent = (id) => {
    // Send a starter message seeded by the chosen intent.
    const seeds = {
      ai_product: "I want to build an AI product.",
      web_app: "I want to build a web app.",
      mobile_app: "I want to build a mobile app.",
      automation: "I want to automate a process.",
      idea: "I have an idea I'd like to explore.",
    };
    sendMessage(seeds[id] || "I have an idea.", id);
  };

  const handleLeadSubmit = async (leadData) => {
    setSubmitting(true);
    setLeadError(null);
    try {
      await submitLead(leadData, briefEdits);
    } catch (e) {
      setLeadError(e?.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* backdrop (mobile) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 z-[55] bg-slate-900/20 backdrop-blur-[2px] sm:bg-transparent sm:backdrop-blur-0"
          />

          <motion.div
            initial={{ x: "100%", opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0.6 }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="fixed inset-0 z-[56] flex flex-col bg-white shadow-2xl sm:inset-y-0 sm:right-0 sm:h-full sm:w-[420px] sm:rounded-l-[2rem]"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-slate-900 to-cyan-700 text-white shadow-sm">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="leading-tight">
                  <p className="text-sm font-semibold tracking-wide text-slate-900">FARTAK INTELLIGENCE</p>
                  <p className="text-[11px] text-slate-400">AI Company Concierge</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && leadStage !== "success" && (
                  <button
                    onClick={reset}
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Start over"
                    title="Start over"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={close}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex min-h-0 flex-1 flex-col">
              {leadStage === "success" ? (
                <SuccessState onReset={reset} />
              ) : leadStage === "form" ? (
                <div className="flex flex-col gap-4 overflow-y-auto px-4 py-5">
                  {brief && (
                    <div className="text-xs font-medium uppercase tracking-wider text-slate-400">
                      Reviewing your brief
                    </div>
                  )}
                  <LeadForm
                    onSubmit={handleLeadSubmit}
                    onCancel={() => ai.setLeadStage ? ai.setLeadStage(null) : reset()}
                    submitting={submitting}
                    error={leadError || error}
                  />
                </div>
              ) : phase === "welcome" ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5">
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-5"
                  >
                    <div className="mb-1.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 to-cyan-700 text-white shadow-sm">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <h2 className="text-lg font-semibold text-slate-900">What are you building?</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Pick a starting point, or just describe your idea. I'll ask the right questions and shape it into a project brief.
                    </p>
                  </motion.div>
                  <IntentCards onPick={handleIntent} onFreeText={() => {}} />
                </div>
              ) : (
                <>
                  <ConversationView
                    messages={messages}
                    status={status}
                    onSend={sendMessage}
                    onRetry={retry}
                    onLead={startLead}
                    phase={phase}
                  />
                  {/* Pinned project brief (review before lead) */}
                  <AnimatePresence>
                    {brief && !leadStage && (
                      <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 12 }}
                        className="border-t border-slate-100 bg-slate-50/40 px-4 py-3"
                      >
                        <ProjectBriefCard
                          brief={briefEdits || brief}
                          onEdit={setBriefEdits}
                          onSubmit={startLead}
                          disabled={status === "thinking" || status === "streaming"}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function SuccessState({ onReset }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 16 }}
        className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-cyan-600 text-white shadow-lg"
      >
        <CheckCircle2 className="h-8 w-8" />
      </motion.div>
      <h2 className="mt-5 text-lg font-semibold text-slate-900">Lead submitted</h2>
      <p className="mt-1.5 max-w-xs text-sm text-slate-500">
        Thank you. The Puyesh Fartak Sina team has your project brief and conversation context, and will reach out soon.
      </p>
      <button
        onClick={onReset}
        className="mt-6 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
      >
        Start a new conversation
      </button>
    </div>
  );
}
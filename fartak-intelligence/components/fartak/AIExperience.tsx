"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, RotateCcw, CheckCircle2, Sparkles, Send, ShieldCheck, Loader2, FileText,
} from "lucide-react";
import IntentCards from "./IntentCards";
import ConversationView from "./ConversationView";
import ProjectBriefCard from "./ProjectBriefCard";
import LeadForm from "./LeadForm";
import { FARTAK_CONFIG } from "../../lib/fartak/config";
import type { Intent, LeadData } from "../../lib/fartak/types";
import type { useFartakAI } from "../../hooks/useFartakAI";

const INTENT_SEEDS: Record<Intent, string> = {
  ai_product: "I want to build an AI product.",
  web_app: "I want to build a web app.",
  mobile_app: "I want to build a mobile app.",
  automation: "I want to automate a process.",
  idea: "I have an idea I'd like to explore.",
};

const CONTACT_LABELS: Record<string, string> = {
  phone: "Phone call",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  email: "Email",
};

// The AI Experience panel — the full state machine surface:
// closed (orb only) → welcome (intent + free text) → conversation →
// project brief review → explicit confirmation → contact form → handoff.
// Contact collection is never reachable before the brief is confirmed.
export default function AIExperience({ ai }: { ai: ReturnType<typeof useFartakAI> }) {
  const {
    isOpen, close, reset, messages, phase, status, brief, error,
    leadStage, handoff, sendMessage, retry, editBrief,
    startConfirmation, confirmBrief, declineContact, submitLead, setLeadStage,
  } = ai;
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [leadError, setLeadError] = useState<string | null>(null);
  const [declinedContact, setDeclinedContact] = useState(false);
  const [welcomeInput, setWelcomeInput] = useState("");
  const welcomeInputRef = useRef<HTMLTextAreaElement>(null);

  const busy = status === "thinking" || status === "streaming";
  // Host feature flags: the handoff flow can be disabled without touching code.
  const canHandoff = FARTAK_CONFIG.features.lead && FARTAK_CONFIG.features.brief;
  const handleStartHandoff = canHandoff ? startConfirmation : () => {};

  const handleIntent = (id: Intent) => sendMessage(INTENT_SEEDS[id] || "I have an idea.", id);

  const sendWelcomeText = () => {
    const t = welcomeInput.trim();
    if (!t || busy) return;
    setWelcomeInput("");
    sendMessage(t);
  };

  // Step 2: explicit final confirmation — required before any handoff.
  const handleConfirm = async () => {
    setConfirming(true);
    setConfirmError(null);
    try {
      await confirmBrief();
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "Confirmation failed");
    } finally {
      setConfirming(false);
    }
  };

  const handleDeclineContact = () => {
    declineContact();
    setDeclinedContact(true);
    setLeadError(null);
  };

  const handleLeadSubmit = async (leadData: LeadData) => {
    setSubmitting(true);
    setLeadError(null);
    try {
      await submitLead(leadData);
    } catch (e) {
      setLeadError(e instanceof Error ? e.message : "Submission failed");
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
                  <p className="text-[11px] text-slate-400">AI Concierge — {FARTAK_CONFIG.companyLabel}</p>
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
                <HandoffState company={FARTAK_CONFIG.companyLabel} handoff={handoff} onReset={reset} />
              ) : leadStage === "form" ? (
                <div className="flex flex-col gap-4 overflow-y-auto px-4 py-5">
                  <LeadForm
                    contactMethods={FARTAK_CONFIG.contactMethods}
                    onSubmit={handleLeadSubmit}
                    onDecline={handleDeclineContact}
                    onCancel={() => setLeadStage(null)}
                    submitting={submitting}
                    error={leadError || error}
                  />
                </div>
              ) : leadStage === "confirm" ? (
                <ConfirmState
                  company={FARTAK_CONFIG.companyLabel}
                  projectName={brief?.project_name}
                  confirming={confirming}
                  error={confirmError}
                  onConfirm={handleConfirm}
                  onBack={() => setLeadStage(null)}
                />
              ) : phase === "welcome" ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5">
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
                    <div className="mb-1.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 to-cyan-700 text-white shadow-sm">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <h2 className="text-lg font-semibold text-slate-900">What are you building?</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Pick a starting point, or just describe your idea. I&apos;ll ask the right questions and
                      shape it into a project brief — no account needed.
                    </p>
                  </motion.div>
                  <IntentCards onPick={handleIntent} onFreeText={() => welcomeInputRef.current?.focus()} />
                  {/* Free-text entry — the conversation starts the moment the visitor types. */}
                  <div className="mt-4 flex items-end gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
                    <textarea
                      ref={welcomeInputRef}
                      value={welcomeInput}
                      onChange={(e) => setWelcomeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendWelcomeText();
                        }
                      }}
                      rows={1}
                      placeholder="…or just describe it here"
                      className="max-h-32 flex-1 resize-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                    />
                    <button
                      onClick={sendWelcomeText}
                      disabled={busy || !welcomeInput.trim()}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white transition hover:bg-slate-800 disabled:opacity-40"
                      aria-label="Send"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <ConversationView
                    messages={messages}
                    status={status}
                    onSend={sendMessage}
                    onRetry={retry}
                    onLead={handleStartHandoff}
                    phase={phase}
                  />
                  {/* Pinned project brief — review and explicitly confirm. */}
                  <AnimatePresence>
                    {brief && FARTAK_CONFIG.features.brief && !leadStage && (
                      <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 12 }}
                        className="border-t border-slate-100 bg-slate-50/40 px-4 py-3"
                      >
                        <ProjectBriefCard
                          brief={brief}
                          onEdit={editBrief}
                          onConfirm={handleStartHandoff}
                          confirmLabel={declinedContact ? "Send to the team" : "Review & confirm"}
                          disabled={busy}
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

// Explicit final confirmation step. Nothing is handed off until the visitor
// confirms with this exact statement.
function ConfirmState({
  company,
  projectName,
  confirming,
  error,
  onConfirm,
  onBack,
}: {
  company: string;
  projectName?: string;
  confirming: boolean;
  error: string | null;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 overflow-y-auto px-5 py-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex items-center gap-2 text-slate-900">
          <ShieldCheck className="h-5 w-5 text-cyan-700" />
          <p className="text-sm font-semibold">Final confirmation</p>
        </div>
        {projectName && (
          <p className="mt-2 text-xs font-medium uppercase tracking-wider text-slate-400">
            {projectName}
          </p>
        )}
        <p className="mt-3 text-sm leading-relaxed text-slate-700">
          I confirm that this project brief is accurate and can be sent to the {company} team.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          After you confirm, we&apos;ll only ask for a way to reach you. Nothing is sent yet.
        </p>
        {error && <p className="mt-3 text-xs font-medium text-red-600">{error}</p>}
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={onBack}
            className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
          >
            Back to edit
          </button>
          <button
            onClick={onConfirm}
            disabled={confirming}
            className="group flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
          >
            {confirming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Confirming…
              </>
            ) : (
              "I confirm — continue"
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// Final handoff screen — the project was received by the team.
function HandoffState({
  company,
  handoff,
  onReset,
}: {
  company: string;
  handoff: ReturnType<typeof useFartakAI>["handoff"];
  onReset: () => void;
}) {
  const reference = handoff?.projectReference || "—";
  const projectName = handoff?.projectName;
  const contactMethod = handoff ? CONTACT_LABELS[handoff.preferredContactMethod] || handoff.preferredContactMethod : "—";

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
      <h2 className="mt-5 text-lg font-semibold tracking-wide text-slate-900">PROJECT RECEIVED</h2>
      <p className="mt-1.5 max-w-xs text-sm text-slate-500">
        Your project has been sent to the {company} team.
      </p>

      <div className="mt-5 w-full max-w-xs rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-left">
        {projectName && (
          <div className="mb-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Project</p>
            <p className="text-sm font-medium text-slate-800">{projectName}</p>
          </div>
        )}
        <div className="mb-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Reference</p>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-cyan-800">
            <FileText className="h-3.5 w-3.5" /> {reference}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Contact</p>
          <p className="text-sm text-slate-800">{contactMethod}</p>
        </div>
      </div>

      <div className="mt-4 w-full max-w-xs text-left">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Next steps</p>
        <ol className="mt-1.5 list-inside list-decimal text-sm text-slate-600">
          <li>Our team reviews your project.</li>
          <li>We evaluate the technical scope.</li>
          <li>We contact you to discuss the next step.</li>
        </ol>
      </div>

      <button
        onClick={onReset}
        className="mt-6 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
      >
        Start a new conversation
      </button>
    </div>
  );
}
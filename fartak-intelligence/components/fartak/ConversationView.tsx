"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Send } from "lucide-react";
import type { ChatMessage, FartakPhase, FartakStatus } from "../../lib/fartak/types";
import { SUGGESTION_CHIPS } from "../../lib/fartak/constants";
import MessageBubble from "./MessageBubble";

// Conversation body: messages, suggestion chips, and the composer input.
export default function ConversationView({
  messages,
  status,
  onSend,
  onRetry,
  onLead,
  phase,
}: {
  messages: ChatMessage[];
  status: FartakStatus;
  onSend: (text: string) => void;
  onRetry: () => void;
  onLead: () => void;
  phase: FartakPhase;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = status === "thinking" || status === "streaming";

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const submit = (text: string) => {
    const t = (text || "").trim();
    if (!t || busy) return;
    onSend(t);
    setInput("");
  };

  const showChips = phase === "welcome" && messages.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-4">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} onRetry={onRetry} onLead={onLead} />
          ))}
        </div>

        {showChips && (
          <div className="mt-5 flex flex-wrap gap-2">
            {SUGGESTION_CHIPS.map((chip) => (
              <motion.button
                key={chip}
                onClick={() => submit(chip)}
                whileHover={{ y: -1 }}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-cyan-300 hover:text-slate-900"
              >
                {chip}
              </motion.button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 bg-white/80 px-3 py-3 backdrop-blur">
        <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-100">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            rows={1}
            placeholder="Describe what you want to build…"
            className="max-h-32 flex-1 resize-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
          />
          <button
            onClick={() => submit(input)}
            disabled={busy || !input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white transition hover:bg-slate-800 disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
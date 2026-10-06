"use client";

import { motion } from "framer-motion";
import type { AgentAction, ChatMessage, FartakStatus } from "../../lib/fartak/types";
import ToolCard from "./ToolCard";

// Renders one message (user or assistant), including thinking/streaming
// state, attached tool cards, and the error/retry affordance.
export default function MessageBubble({
  message,
  onRetry,
  onLead,
}: {
  message: ChatMessage;
  onRetry?: () => void;
  onLead?: () => void;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-end"
      >
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-slate-900 px-3.5 py-2.5 text-sm text-white shadow-sm">
          {message.content}
        </div>
      </motion.div>
    );
  }

  const isThinking = message.streaming && !message.content && !message.error;
  const hasError = message.error;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-start gap-2"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-900 to-cyan-700 text-white shadow-sm">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3l1.9 5.8L20 12l-6.1 3.2L12 21l-1.9-5.8L4 12l6.1-3.2L12 3z" />
          </svg>
        </span>
        {isThinking ? (
          <div className="flex items-center gap-1 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-3.5 py-3">
            {[0, 1, 2].map((d) => (
              <motion.span
                key={d}
                className="h-1.5 w-1.5 rounded-full bg-cyan-500"
                animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                transition={{ duration: 1, repeat: Infinity, delay: d * 0.18 }}
              />
            ))}
          </div>
        ) : hasError ? (
          <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            <p>I hit a snag on that request.</p>
            <button
              onClick={onRetry}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-red-700 underline-offset-2 hover:underline"
            >
              Try again →
            </button>
          </div>
        ) : (
          <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-md border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-800">
            {message.content}
            {message.streaming && (
              <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-cyan-500 align-middle" />
            )}
          </div>
        )}
      </div>

      {(message.actions?.length ?? 0) > 0 && (
        <div className="ml-9 flex w-full flex-col gap-2">
          {(message.actions as AgentAction[]).map((action, idx) => (
            <ToolCard key={idx} action={action} onLead={onLead} />
          ))}
        </div>
      )}
    </motion.div>
  );
}
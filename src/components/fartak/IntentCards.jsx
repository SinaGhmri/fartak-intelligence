import { motion } from "framer-motion";
import { INTENTS } from "@/lib/fartak/constants";

// Intent selection — the "What are you building?" surface.
export default function IntentCards({ onPick, onFreeText }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {INTENTS.map((it, i) => {
          const Icon = it.icon;
          return (
            <motion.button
              key={it.id}
              onClick={() => onPick(it.id)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.3 }}
              whileHover={{ y: -2 }}
              className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-cyan-300 hover:shadow-[0_8px_24px_-12px_rgba(8,145,178,0.4)]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-900 to-cyan-700 text-white shadow-sm">
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-slate-900">{it.label}</span>
                <span className="text-xs text-slate-500">{it.description}</span>
              </span>
            </motion.button>
          );
        })}
      </div>
      <button
        onClick={onFreeText}
        className="self-center text-xs font-medium text-slate-400 underline-offset-4 hover:text-slate-700 hover:underline"
      >
        or just describe it in your own words
      </button>
    </div>
  );
}
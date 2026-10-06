"use client";

import { motion } from "framer-motion";

// Premium AI Orb — the Fartak Intelligence entry point. A luminous orb with
// a breathing core and an orbiting ring; floats above the host website.
export default function AIOrb({ open, isOpen }: { open: () => void; isOpen: boolean }) {
  return (
    <motion.button
      onClick={open}
      aria-label="Open Fartak Intelligence"
      className="fixed bottom-5 right-5 sm:bottom-7 sm:right-7 z-[60] group"
      initial={false}
      animate={isOpen ? { scale: 0.6, opacity: 0 } : { scale: 1, opacity: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      style={{ pointerEvents: isOpen ? "none" : "auto" }}
    >
      <span className="relative flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center">
        {/* soft glow */}
        <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,#6ee7ff55,transparent_60%)] blur-md transition group-hover:bg-[radial-gradient(circle_at_30%_30%,#6ee7ff88,transparent_60%)]" />
        {/* orbiting ring */}
        <motion.span
          className="absolute inset-0 rounded-full border border-cyan-300/40"
          animate={{ rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          style={{ borderTopColor: "rgba(34,211,238,0.9)", borderRightColor: "transparent", borderBottomColor: "transparent", borderLeftColor: "transparent" }}
        />
        {/* core */}
        <motion.span
          className="relative flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-700 shadow-[0_8px_30px_rgba(8,145,178,0.35)] ring-1 ring-white/10"
          animate={{ scale: [1, 1.06, 1] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        >
          <span className="absolute inset-1 rounded-full bg-[radial-gradient(circle_at_35%_30%,rgba(255,255,255,0.85),rgba(34,211,238,0.25)_45%,transparent_70%)]" />
          <span className="relative h-2 w-2 rounded-full bg-white shadow-[0_0_12px_4px_rgba(255,255,255,0.7)]" />
        </motion.span>
      </span>
      <span className="pointer-events-none absolute -top-1 right-0 whitespace-nowrap rounded-full bg-slate-900/90 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-cyan-200 opacity-0 shadow-lg ring-1 ring-white/10 transition group-hover:opacity-100">
        Fartak Intelligence
      </span>
    </motion.button>
  );
}
"use client";

import { motion } from "framer-motion";
import { KeyRound, Lock, ShieldCheck } from "lucide-react";

const STAGES = [
  {
    icon: <KeyRound size={18} />,
    label: "Leaked key detected",
    detail: "Public repo, real funds",
    tone: "amber" as const,
  },
  {
    icon: <Lock size={18} />,
    label: "Swept into shielded pool",
    detail: "Unlinkable on-chain",
    tone: "pink" as const,
  },
  {
    icon: <ShieldCheck size={18} />,
    label: "Returned to verified owner",
    detail: "Private transfer, in full",
    tone: "emerald" as const,
  },
];

const ICON_TONES: Record<(typeof STAGES)[number]["tone"], string> = {
  amber:
    "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/60",
  pink: "text-white border-transparent",
  emerald:
    "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800/60",
};

// Small always-visible diagram of the rescue pipeline (detect → shield →
// return), placed next to the hero copy so the architecture is legible at a
// glance instead of only described in prose further down the page.
export function HeroVisual() {
  return (
    <div className="relative w-full max-w-sm mx-auto lg:mx-0">
      <div
        aria-hidden
        className="absolute -inset-10 rounded-[2rem] opacity-50 blur-3xl -z-10 pointer-events-none"
        style={{ background: "radial-gradient(circle at 30% 20%, var(--pink-soft-2), transparent 65%)" }}
      />
      <div className="ls-card p-6 sm:p-7">
        <div className="flex items-center justify-between mb-6">
          <p className="text-xs font-bold uppercase tracking-widest text-ls-gray-400">
            How a rescue moves
          </p>
          <span className="status-live text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            Live
          </span>
        </div>

        <div className="flex flex-col">
          {STAGES.map((s, i) => (
            <div key={s.label}>
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.15, duration: 0.4 }}
                className="flex items-center gap-3"
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${ICON_TONES[s.tone]}`}
                  style={s.tone === "pink" ? { background: "var(--pink)" } : undefined}
                >
                  {s.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-black dark:text-white">{s.label}</p>
                  <p className="text-xs text-ls-gray-500 dark:text-ls-gray-400">{s.detail}</p>
                </div>
              </motion.div>
              {i < STAGES.length - 1 && (
                <div className="ml-5 my-1.5 w-px h-5 border-l-2 border-dashed border-ls-gray-200 dark:border-ls-gray-700" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

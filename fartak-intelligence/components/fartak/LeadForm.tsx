"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { User, Mail, Phone, Loader2, ArrowRight } from "lucide-react";
import type { ContactMethod, LeadData } from "../../lib/fartak/types";

const METHOD_LABELS: Record<ContactMethod, string> = {
  phone: "Phone call",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  email: "Email",
};

// Minimum contact form — shown ONLY after the brief was explicitly confirmed.
// Required: full name + mobile phone. Email is optional, unless the visitor
// picks email as their preferred contact method. No project questions here:
// all project information already lives in the confirmed Project Brief.
export default function LeadForm({
  contactMethods,
  onSubmit,
  onDecline,
  onCancel,
  submitting,
  error,
}: {
  contactMethods: ContactMethod[];
  onSubmit: (data: LeadData) => void;
  onDecline: () => void;
  onCancel: () => void;
  submitting?: boolean;
  error?: string | null;
}) {
  const methods = contactMethods.length ? contactMethods : (["phone"] as ContactMethod[]);
  const [form, setForm] = useState<LeadData>({
    name: "",
    phone: "",
    email: "",
    preferredContactMethod: methods[0],
  });
  const [touched, setTouched] = useState<{ name?: boolean; phone?: boolean; email?: boolean }>({});

  const set = <K extends keyof LeadData>(k: K, v: LeadData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const nameOk = !!form.name.trim();
  const phoneOk = form.phone.replace(/\D/g, "").length >= 7;
  const emailOk = !form.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
  const emailRequired = form.preferredContactMethod === "email";
  const emailValid = emailRequired ? !!form.email && emailOk : emailOk;
  const canSubmit = nameOk && phoneOk && emailValid && !submitting;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, phone: true, email: true });
    if (!canSubmit) return;
    onSubmit(form);
  };

  const fieldClass = (hasError: boolean) =>
    `w-full rounded-xl border bg-white pl-9 pr-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 ${
      hasError ? "border-red-300" : "border-slate-200"
    }`;

  return (
    <motion.form
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div>
        <p className="text-sm font-semibold text-slate-900">Where should we reach you?</p>
        <p className="text-xs text-slate-500">
          Your project brief is confirmed — we only need a way to contact you. Nothing else is asked.
        </p>
      </div>

      <div className="relative">
        <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
          placeholder="Full name *"
          className={fieldClass(!!(touched.name && !nameOk))}
        />
      </div>

      <div className="relative">
        <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
          placeholder="Mobile phone *"
          inputMode="tel"
          className={fieldClass(!!(touched.phone && !phoneOk))}
        />
      </div>

      <div className="relative">
        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          placeholder={`Email ${emailRequired ? "*" : "(optional)"}`}
          className={fieldClass(!!(touched.email && !emailValid))}
        />
      </div>

      <div>
        <p className="text-xs font-medium text-slate-500">Preferred contact method *</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {methods.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => set("preferredContactMethod", m)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                form.preferredContactMethod === m
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:border-cyan-300"
              }`}
            >
              {METHOD_LABELS[m]}
            </button>
          ))}
        </div>
        {form.preferredContactMethod !== "email" && (
          <p className="mt-1.5 text-[11px] text-slate-400">
            We&apos;ll use the phone number above for WhatsApp/Telegram — no need to repeat it.
          </p>
        )}
      </div>

      {error && <p className="text-xs font-medium text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="group flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Sending…
            </>
          ) : (
            <>
              Send my project <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </div>

      <button
        type="button"
        onClick={onDecline}
        className="self-center text-[11px] font-medium text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
      >
        I&apos;d rather not share contact details
      </button>
    </motion.form>
  );
}
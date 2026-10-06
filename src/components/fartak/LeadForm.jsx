import { useState } from "react";
import { motion } from "framer-motion";
import { User, Mail, Phone, Building2, Loader2, ArrowRight } from "lucide-react";

// Lead capture form. Validated client-side and again server-side (aiChat submit_lead).
// A lead is never created without explicit submission here.
export default function LeadForm({ onSubmit, onCancel, submitting, error }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", message: "" });
  const [touched, setTouched] = useState({});

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);

  const canSubmit = form.name.trim() && emailOk && !submitting;

  const handleSubmit = (e) => {
    e.preventDefault();
    setTouched({ name: true, email: true });
    if (!canSubmit) return;
    onSubmit(form);
  };

  const fieldClass = (hasError) =>
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
        <p className="text-sm font-semibold text-slate-900">Almost there</p>
        <p className="text-xs text-slate-500">Share your contact details and the team will follow up with full context.</p>
      </div>

      <div className="relative">
        <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
          placeholder="Full name"
          className={fieldClass(touched.name && !form.name.trim())}
        />
      </div>

      <div className="relative">
        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          placeholder="Email"
          className={fieldClass(touched.email && !emailOk)}
        />
      </div>

      <div className="relative">
        <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
          placeholder="Phone (optional)"
          className={fieldClass(false)}
        />
      </div>

      <div className="relative">
        <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={form.company}
          onChange={(e) => set("company", e.target.value)}
          placeholder="Company (optional)"
          className={fieldClass(false)}
        />
      </div>

      <textarea
        value={form.message}
        onChange={(e) => set("message", e.target.value)}
        placeholder="Anything else? (optional)"
        rows={2}
        className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
      />

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
              <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
            </>
          ) : (
            <>
              Submit lead <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </div>
    </motion.form>
  );
}
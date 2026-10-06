// Server-side configuration. Everything tunable lives here or in env vars —
// no environment-specific values are hard-coded.

export const serverConfig = {
  // Company identity injected into the system prompt and lead copy.
  companyName: process.env.FARTAK_COMPANY_NAME || "Puyesh Fartak Sina",

  // Approved navigation targets (must match what the host site supports).
  navTargets: (process.env.FARTAK_NAV_TARGETS || "home,about,services,projects,process,contact")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Contact methods the company actually supports. Only these are offered to
  // the visitor as their preferred contact method (validated server-side).
  contactMethods: (process.env.FARTAK_CONTACT_METHODS || "phone,whatsapp,telegram,email")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Prefix for the human-readable project reference (e.g. FTK-2048).
  referencePrefix: process.env.FARTAK_REFERENCE_PREFIX || "FTK",

  // Conversation engine limits.
  maxMessageLength: 2000,
  maxHistory: 20,
  maxAgentTurns: 4,

  // Rate limiting (best-effort, per-instance).
  rateLimitWindowMs: 60_000,
  rateLimitMax: 20,
};
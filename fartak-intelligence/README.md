# Fartak Intelligence — Embeddable AI Concierge for Next.js

A complete, portable AI concierge module: conversation engine, adaptive project
discovery, Knowledge-Base-grounded answers (RAG), controlled agent tools,
editable project briefs, and confirmation-gated lead capture. Mount it inside
**your** Next.js website — it is an embedded intelligence layer, not a website.

```
fartak-intelligence/
├── components/fartak/       # UI (all "use client", plain Tailwind)
│   ├── FartakIntelligence.tsx   ← the single mount point
│   ├── AIOrb.tsx  AIExperience.tsx  ConversationView.tsx
│   ├── MessageBubble.tsx  IntentCards.tsx  ToolCard.tsx
│   └── ProjectBriefCard.tsx  LeadForm.tsx
├── hooks/useFartakAI.ts     # the full state machine
├── lib/fartak/              # types, config, constants, analytics, apiClient, bridge
├── app/api/fartak/          # Next.js App Router route handlers
│   ├── chat/route.ts        # conversation engine endpoint
│   ├── brief/route.ts       # explicit brief confirmation endpoint
│   └── lead/route.ts        # project handoff endpoint
├── server/fartak/           # agent, tools, knowledge (RAG), system prompt,
│   └── ...                  # provider abstraction, storage (Prisma), rate limit
└── prisma/schema.prisma     # database schema
```

---

## 1. What to copy — and what NOT to copy

**Copy into your Next.js project** (keep the relative paths between these
folders, or adjust imports):

| Module path | Copy to |
|---|---|
| `components/fartak/` | `<your-app>/components/fartak/` |
| `hooks/useFartakAI.ts` | `<your-app>/hooks/` |
| `lib/fartak/` (types, config, constants, analytics, apiClient, bridge) | `<your-app>/lib/fartak/` |
| `app/api/fartak/` | `<your-app>/app/api/fartak/` |
| `server/fartak/` | `<your-app>/server/fartak/` |
| `prisma/schema.prisma` | merge models into your existing `schema.prisma` |

**Do NOT copy:** the Base44 prototype website (pages, sections, routing) — that
lives in this workspace only. Also do not copy anything from `@base44/sdk`; the
module has **zero Base44 dependencies**.

## 2. npm dependencies

Add to your Next.js app (everything else the module uses is React/Tailwind built-ins):

```bash
npm install framer-motion lucide-react
npm install -D prisma && npm install @prisma/client
```

Tailwind CSS is assumed to already be configured in your host project.

## 3. Environment variables

```env
# Required — your AI provider key (never exposed to the browser)
FARTAK_LLM_API_KEY=sk-...

# Optional — any OpenAI-compatible endpoint (OpenRouter, Groq, Azure gateway, vLLM, …)
FARTAK_LLM_BASE_URL=https://api.openai.com/v1
FARTAK_LLM_MODEL=gpt-4o-mini

# Optional — identity and approved navigation targets
FARTAK_COMPANY_NAME=Puyesh Fartak Sina
FARTAK_NAV_TARGETS=home,about,services,projects,process,contact

# Optional — supported contact methods (only these are offered to the visitor)
# and the project reference prefix (e.g. FTK-2048)
FARTAK_CONTACT_METHODS=phone,whatsapp,telegram,email
FARTAK_REFERENCE_PREFIX=FTK

# Required — database (Prisma)
DATABASE_URL=postgresql://...
```

For a non-OpenAI-compatible provider (e.g. Anthropic), implement the
`LLMProvider` interface in `server/fartak/provider.ts` and register it with
`setLLMProvider()` at startup — that file is the only place a vendor is named.

## 4. Database

The schema defines five tables: `Conversation`, `Message`, `KnowledgeEntry`,
`ProjectBrief`, `Lead`.

```bash
npx prisma migrate dev --name fartak-intelligence
```

All data access is isolated in `server/fartak/storage.ts` — swapping Prisma for
another ORM means rewriting that one file.

## 5. Knowledge Base configuration

Seed the `KnowledgeEntry` table with your verified company data. Categories:
`company | services | projects | technologies | process | faq`.

- `refId` — stable slug; `show_service`/`show_project` look entries up by it.
- `isPlaceholder: true` — content not yet verified. The system prompt forbids
  the AI from presenting it as fact; the UI shows an "awaiting verified content"
  badge. Keep every unconfirmed fact (clients, prices, team, case studies) as a
  placeholder until you have the real data.

Seed example (`prisma/knowledge.seed.ts` or any script):
```ts
await prisma.knowledgeEntry.create({
  data: {
    category: "services",
    title: "AI Products",
    refId: "service-ai-product",
    isPlaceholder: false, // true until content is verified
    tags: ["ai", "product"],
    content: "End-to-end AI product development…",
  },
});
```

## 6. Mounting `<FartakIntelligence />`

Mount once in your root layout (it is a client component; a server layout can
render it directly):

```tsx
// app/layout.tsx
import FartakIntelligence from "@/components/fartak/FartakIntelligence";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <FartakIntelligence />
      </body>
    </html>
  );
}
```

The AI Orb then floats above every page. Panel state (open/close) preserves the
conversation; on mobile the panel is full-screen.

## 7. Connecting navigation (host controls it)

```tsx
<FartakIntelligence
  onNavigate={(target) => router.push(`/#${target}`)}
/>
```

- Without `onNavigate`, the default smooth-scrolls to `document.getElementById(target)`.
- Approved targets come from `FARTAK_NAV_TARGETS` (server whitelist) and
  `FARTAK_CONFIG.navTargets` (client). The AI can never navigate anywhere else.
- Any of your buttons can open the concierge:
  ```tsx
  import { openFartak } from "@/lib/fartak/bridge";
  <button onClick={openFartak}>Talk to our AI</button>
  ```

## 8. Connecting analytics

```ts
// anywhere at startup (client side)
import { setFartakAnalytics } from "@/lib/fartak/analytics";
setFartakAnalytics((event, properties) => {
  // forward to GA4 / Mixpanel / PostHog / anything
});
```

Events: `ai_opened`, `intent_selected`, `conversation_started`,
`discovery_started`, `project_brief_generated`, `project_brief_edited`,
`project_brief_confirmed`, `contact_form_started`, `contact_submitted`,
`contact_declined`, `project_handoff_completed`, `tool_used`,
`conversation_error`. Alternatively, listen for the `fartak:analytics` window event.

## 9. Connecting project handoff

The handoff funnel is: discovery → brief review (editable) → **explicit
confirmation** → minimum contact form (name + phone; email only if chosen as
the contact method) → handoff. The flow is guest-first: no account or login is
ever required, contact details are never requested during discovery, and the
visitor can decline contact without losing the brief.

Leads are stored in the `Lead` table with a unique human-readable reference
(`projectReference`, e.g. `FTK-2048`), linked to the conversation and the
confirmed project brief. The full discovery context stays server-side: the
complete message transcript, an AI conversation summary, and the confirmed
brief (confirmed requirements, assumptions, and open questions). Optional
client callback:

```tsx
<FartakIntelligence onLeadSubmitted={(leadId, projectReference) => { /* CRM sync, etc. */ }} />
```

The AI can never create a lead — only the visitor, via the explicit
review → confirm → form → submit flow (`/api/fartak/brief` and
`/api/fartak/lead` validate server-side; the contact form is unreachable
before the brief is confirmed).

## 10. Configuration layer

```ts
import { configureFartak } from "@/lib/fartak/config";

configureFartak({
  companyLabel: "Puyesh Fartak Sina",
  chatEndpoint: "/api/fartak/chat",
  briefEndpoint: "/api/fartak/brief",
  leadEndpoint: "/api/fartak/lead",
  navTargets: ["home", "about", "services", "projects", "process", "contact"],
  contactMethods: ["phone", "whatsapp", "telegram", "email"],
  features: { navigation: true, brief: true, lead: true },
});
```

Server-side equivalents live in `server/fartak/config.ts` (env-driven).

## 11. Deploying

1. Copy the folders (see §1), install deps, merge the Prisma schema.
2. Set the env vars (§3) in your hosting provider.
3. `npx prisma migrate deploy` (or `prisma generate` + your migration flow).
4. Deploy as a normal Next.js app (Vercel, self-hosted, etc.). Both routes run
   on the Node.js runtime.

## 12. Base44 dependency report

**Base44-specific (stay in the Base44 prototype — do NOT copy):**
- `@base44/sdk` client (`base44.functions.invoke`, `base44.asServiceRole.*`,
  `base44.entities.*`, `base44.auth`)
- The `aiChat` backend function, `base44/shared/fartak/*`, and the Base44
  entity schemas (`base44/entities/*.jsonc`)
- The prototype website (`src/pages`, `src/components/site`)

**Portable (copied as-is, zero Base44 deps):**
- Every UI component, the `useFartakAI` state machine, analytics, the bridge,
  the system prompt content, the agent loop design, RAG scoring, the tool
  whitelisting approach, rate limiting, and the lead flow.

**Replaced when moving (Base44 → standard Next.js):**
- `base44.functions.invoke("aiChat")` → `POST /api/fartak/chat` (fetch)
- `InvokeLLM` integration → `server/fartak/provider.ts` (OpenAI-compatible
  adapter; any provider via `setLLMProvider`)
- Base44 entities → Prisma models (`server/fartak/storage.ts`)
- Vite/react-router prototype hosting → your Next.js App Router

## 13. What is intentionally still placeholder

Only the company's factual content: real services, projects, clients, case
studies, pricing, team, verified technology stack, and company FAQs. The AI
engine, UI, agent, RAG, brief, and lead flows are complete and implementation-
ready. Seed the Knowledge Base with verified data and the concierge grounds
itself — it will never invent facts in the meantime.
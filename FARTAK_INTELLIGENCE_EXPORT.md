# Fartak Intelligence — Export Manifest

**Export date:** 2026-10-04 · **State:** complete current workspace state, implementation untouched (export-only).

This repository contains the **complete current state** of Fartak Intelligence for inspection: the portable Next.js module AND the Base44 prototype it was originally built on. The Base44 prototype is intentionally included and is not removed.

---

## 1. Project Architecture (top level)

```
fartak-intelligence/            ← Portable Next.js module (zero Base44 deps, deployable)
src/components/fartak/          ← Base44 prototype UI (React + Vite demo)
src/lib/fartak/                 ← Base44 prototype client lib (hooks, config, bridge, analytics)
base44/functions/aiChat/        ← Base44 prototype conversation engine (backend function)
base44/shared/fartak/           ← Base44 prototype server logic (prompt, tools, RAG)
base44/entities/*.jsonc         ← Base44 entity schemas (Conversation, Message,
                                  KnowledgeEntry, ProjectBrief, Lead)
FARTAK_INTELLIGENCE_EXPORT.md  ← this file
.env.example                    ← required environment variable names (no values)
```

Two parallel implementations exist:

- **Portable module** (`fartak-intelligence/`) — the deployable artifact, one funnel-generation ahead.
- **Base44 prototype** (`src/… + base44/…`) — the live-preview demo; older brief schema
  (no readiness / assumptions / open_questions, `stage`+`notes` instead).

---

## 2. Portable Module Architecture (`fartak-intelligence/`)

```
components/fartak/    UI (all "use client", plain Tailwind):
                      FartakIntelligence (mount point) · AIOrb · AIExperience
                      ConversationView · MessageBubble · IntentCards · ToolCard
                      ProjectBriefCard · LeadForm
hooks/useFartakAI.ts  Client state machine: phase, status, leadStage, handoff
lib/fartak/           types · config (FARTAK_CONFIG) · apiClient · analytics · bridge · constants
app/api/fartak/       chat/route.ts · brief/route.ts · lead/route.ts (Node runtime)
server/fartak/        agent · tools · systemPrompt · knowledge (RAG) · provider (LLM)
                      · storage (all Prisma access) · rateLimit · config
prisma/schema.prisma  5 models: Conversation, Message, KnowledgeEntry, ProjectBrief, Lead
```

**Data flow:** `useFartakAI.sendMessage()` → `POST /api/fartak/chat` → rate limit →
persist user message → load last 20 messages → keyword RAG → system prompt →
agent loop (≤4 turns, single JSON reply, tool results fed back) → persist
assistant message → `{conversationId, message, actions, brief, readiness}` →
client streams reply text and renders action cards.

The LLM vendor is abstracted behind the `LLMProvider` interface
(`server/fartak/provider.ts`). The default adapter speaks any
OpenAI-compatible `/v1/chat/completions` endpoint (OpenAI, OpenRouter, Groq,
Together, Azure gateways, vLLM, Ollama). Swap vendors by implementing
`LLMProvider` and calling `setLLMProvider()` — no UI change ever needed.

---

## 3. Base44 Prototype Architecture

- **UI:** `src/components/fartak/*` + `src/lib/fartak/*` — same experience shape
  (orb → welcome intents → conversation → brief), older funnel.
- **Engine:** `base44/functions/aiChat/entry.ts` — Base44 backend function using
  the platform-managed `InvokeLLM` integration; model constant `FARTAK_MODEL`
  (`"automatic"`; comment recommends `"claude-sonnet-5"` for more reliable brief
  extraction). Provider-independent: the model is chosen server-side only.
- **Shared logic:** `base44/shared/fartak/` — system prompt, tools, keyword RAG.
- **Data:** Base44 entities (`base44/entities/*.jsonc`). 14 knowledge entries
  seeded in the prototype's Base44 database (9 of 14 placeholders).
- **Dependencies:** `@base44/sdk`, platform auth/entities — NOT part of the
  portable module.

---

## 4. Environment Variables

See `.env.example` (names only — never commit real values).

| Variable | Required | Purpose | Default |
|---|---|---|---|
| `FARTAK_LLM_API_KEY` | **Yes** | LLM provider auth (Bearer) | — (throws if unset) |
| `FARTAK_LLM_BASE_URL` | No | Provider endpoint | `https://api.openai.com/v1` |
| `FARTAK_LLM_MODEL` | No | Model name | `gpt-4o-mini` |
| `DATABASE_URL` | **Yes** | PostgreSQL connection (Prisma) | — |
| `FARTAK_COMPANY_NAME` | No | Company identity in prompt/UI copy | `Puyesh Fartak Sina` |
| `FARTAK_CONTACT_METHODS` | No | Allowed preferred-contact methods (server-validated) | `phone,whatsapp,telegram,email` |
| `FARTAK_REFERENCE_PREFIX` | No | Handoff reference prefix (e.g. `FTK-2048`) | `FTK` |
| `FARTAK_NAV_TARGETS` | No | Navigation whitelist for the AI | `home,about,services,projects,process,contact` |

All are read **server-side only**. Client config lives in code
(`lib/fartak/config.ts`, patchable via `configureFartak()`).

---

## 5. Database Requirements

- **Engine:** PostgreSQL (Prisma `provider = "postgresql"`; SQLite possible for
  local prototyping by editing that line).
- **5 models:** `Conversation`, `Message`, `KnowledgeEntry`, `ProjectBrief`, `Lead`.
- **Relations:** logical scalar pointers (`Conversation.briefId/leadId`,
  `Message.conversationId`, `ProjectBrief.conversationId`,
  `Lead.conversationId/projectBriefId`) — no Prisma `@relation` directives;
  joins happen in `server/fartak/storage.ts`.
- **Notable columns:** `Lead.projectReference` (`@unique`, FTK-xxxx),
  `ProjectBrief.status/confirmedAt/readiness` (JSON string),
  `Message.toolName/toolArgs/toolResult/cards` (tool traceability),
  `KnowledgeEntry.refId` (`@unique` slug) and `isPlaceholder`.

---

## 6. Prisma Setup

Prisma is **not vendored** in this repo (no generated client, no migrations) —
install it in the host project:

```bash
npm install prisma --save-dev
npm install @prisma/client
# merge prisma/schema.prisma models into the host schema (or use as-is)
npx prisma migrate dev --name fartak-intelligence   # dev
npx prisma migrate deploy                           # production
# then seed the KnowledgeEntry table with verified company content
```

---

## 7. LLM Provider Configuration

1. Set `FARTAK_LLM_API_KEY` (required).
2. Optionally set `FARTAK_LLM_BASE_URL` (any OpenAI-compatible gateway) and
   `FARTAK_LLM_MODEL`.
3. Replies are forced to JSON (`response_format: json_object`); a tolerant
   `safeParse` extracts JSON from prose/fences as a fallback.
4. The provider is touched by exactly two call sites: the agent loop (chat) and
   the optional lead-summary call (fails soft to a deterministic summary).

---

## 8. API Routes (portable module)

| Route | Method | Purpose | Auth | LLM |
|---|---|---|---|---|
| `/api/fartak/chat` | POST | Conversation engine (session-scoped ownership, rate-limited, ≤2000-char messages) | Anonymous session cookie (HttpOnly), guest-first | ≤4 calls/turn |
| `/api/fartak/brief` | POST | Explicit brief confirmation (ownership-checked, applies sanitized edits, server sets `status`/`confirmedAt`). Public GET removed. | Anonymous session → conversation → brief chain | No |
| `/api/fartak/lead` | POST | Project handoff (ownership + confirmed-brief gate, contact validation, idempotent single Lead, server-generated FTK reference) | Anonymous session chain, `Lead.conversationId @unique` | 1 optional call |

---

## 9. Agent / Tool Architecture

The model never runs code, touches the DOM, or navigates URLs. Each turn it
returns ONE JSON object with typed action channels mapped to validated tools:

| Tool | Effect | DB write |
|---|---|---|
| `searchCompany/Projects/Services` | RAG over KnowledgeEntry, fed back as context | tool trace message |
| `showProject` / `showService` | UI knowledge card (looked up by `refId`) | No |
| `navigateTo` | scroll request to a whitelisted host section only | No |
| `createProjectBrief` | creates the structured brief (+readiness) | **Yes** (ProjectBrief) |

There is deliberately **no `create_lead` tool** — leads are created only by the
human through `/api/fartak/lead`. `readiness` is metadata (ready /
missingCritical / missingOptional — never a numeric score).

---

## 10. Discovery → Brief → Confirmation → Contact → Handoff Flow

1. **Discovery** (guest-first, no login): adaptive questioning, requirement
   extraction, no repeated questions; contact details are never requested
   during discovery.
2. **Brief**: `createProjectBrief` — confirmed fields, `assumptions`
   (amber), `open_questions` (rose); readiness evaluated internally.
3. **Review**: `ProjectBriefCard` — visitor edits any field/list.
4. **Explicit confirmation**: `ConfirmState` — "I confirm that this project
   brief is accurate and can be sent to the team" → `POST /api/fartak/brief`
   → `status=confirmed`. Contact collection is structurally unreachable before
   this step (`leadStage === "form"` only after confirmation succeeds).
5. **Contact**: minimal form — full name + phone required; email only if the
   chosen method is email; methods limited to configured ones. Declining is
   graceful — the confirmed brief remains.
6. **Handoff**: FTK reference generated, Lead + conversation summary +
   full transcript persisted, success screen with reference, host
   `onLeadSubmitted(leadId, reference)` callback.

---

## 11. Known Limitations

1. The entire funnel is prompt-driven and has never run end-to-end (see §12).
2. Base44 prototype is one generation behind the module (older brief schema).
3. Knowledge base is mostly placeholder (9/14 prototype entries; module table
   empty until seeded) — the AI honestly reports "not available" rather than
   inventing facts.
4. Rate limiting is per-instance, in-memory (serverless instances reset it);
   keys combine the anonymous-session hash with the client IP. Suitable for
   development/single-instance — move to shared infrastructure (Redis/Upstash)
   for multi-instance production.
5. API routes are guest-first (no login) but no longer unauthenticated in the
   insecure sense: every Conversation/Brief/Lead is owned by a cryptographically
   random HttpOnly session cookie (SHA-256 hash stored server-side). The former
   `GET /api/fartak/brief` public read endpoint has been removed.
6. No email/notification on handoff — leads are only stored; consume
   `onLeadSubmitted` or query the DB.
7. FTK reference: 4-digit random (9,000 space) with retry + timestamp fallback;
   unique-constraint-safe but not sequential.
8. Conversation prompting capped at last 20 messages (full transcript still
   persisted).
9. No automated test suite.

---

## 12. Currently Untested Components

Never executed at runtime: Next.js build · Prisma generate/migrate · any real
LLM call · a real chat conversation · brief generation · brief confirmation ·
contact submission · handoff · FTK reference generation · Prisma persistence ·
model quality comparison for brief extraction.

Verified statically only: strict-mode TypeScript compilation (exit 0),
zero Base44 references inside `fartak-intelligence/`, funnel gating logic,
validation rules, Prisma schema ↔ code consistency (typechecked against
shims — `prisma validate` never run).

---

## 13. Running the Portable Module in a Next.js Application

**Prerequisites:** Node 18+ · PostgreSQL · an LLM API key · a Next.js App
Router project with Tailwind CSS.

1. **Install packages:**
   `npm install framer-motion lucide-react @prisma/client && npm install -D prisma typescript`
2. **Copy the module** into the host, preserving relative paths:
   - `fartak-intelligence/components/fartak/` → `<host>/components/fartak/`
   - `fartak-intelligence/hooks/` → `<host>/hooks/`
   - `fartak-intelligence/lib/` → `<host>/lib/`
   - `fartak-intelligence/app/api/fartak/` → `<host>/app/api/fartak/`
   - `fartak-intelligence/server/` → `<host>/server/`
   - merge `fartak-intelligence/prisma/schema.prisma` into the host Prisma schema
3. **Configure environment** (`.env.local` in the host):
   `FARTAK_LLM_API_KEY`, `DATABASE_URL` (minimum); optionally
   `FARTAK_LLM_BASE_URL`, `FARTAK_LLM_MODEL`, `FARTAK_COMPANY_NAME`,
   `FARTAK_CONTACT_METHODS`, `FARTAK_REFERENCE_PREFIX`, `FARTAK_NAV_TARGETS`.
4. **Database:** `npx prisma migrate dev --name fartak-intelligence`, then seed
   `KnowledgeEntry` with verified company content (mark unverified entries
   `isPlaceholder = true`).
5. **Mount once** in the root layout (or a client wrapper):
   ```tsx
   <FartakIntelligence
     onNavigate={(target) => router.push(`/#${target}`)}        // optional
     onLeadSubmitted={(leadId, reference) => syncCRM(leadId, reference)} // optional
   />
   ```
   Without `onNavigate` it smooth-scrolls to `id="<target>"` elements; any host
   button can open it via `openFartak()` (`lib/fartak/bridge`).
6. **Verify:** the floating orb appears; a conversation persists messages;
   brief generation produces a reviewable card; confirmation unlocks the
   contact form; a lead submission returns an FTK reference.

**Tailwind:** default config is sufficient (standard utilities only — no custom
tokens or plugins required). All three API routes use the Node.js runtime.
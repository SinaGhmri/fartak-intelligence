// POST /api/fartak/brief — explicit final confirmation of the Project Brief.
// The project is never handed off automatically: the lead/contact flow only
// unlocks after this endpoint confirms the visitor's (optionally edited)
// brief. Server-side validated; edits are applied and the brief is marked
// confirmed with a timestamp.

import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientKey } from "../../../../server/fartak/rateLimit";
import { getBrief, updateBrief } from "../../../../server/fartak/storage";
import type { ProjectBriefEdits } from "../../../../lib/fartak/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    if (!rateLimit(`brief:${clientKey(req.headers)}`)) {
      return NextResponse.json({ error: "Rate limit exceeded. Please slow down." }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const briefId = (body.briefId || "").toString().trim().slice(0, 100);
    const briefUpdates = body.briefUpdates as ProjectBriefEdits | null | undefined;

    if (!briefId) return NextResponse.json({ error: "Missing brief" }, { status: 400 });

    // Apply the visitor's edits and mark the brief confirmed.
    const brief = await updateBrief(
      briefId,
      briefUpdates && typeof briefUpdates === "object" ? briefUpdates : {},
      true
    );

    if (!brief) return NextResponse.json({ error: "Brief not found" }, { status: 404 });

    return NextResponse.json({ ok: true, brief });
  } catch (error) {
    console.error("[fartak/brief]", error);
    const msg = error instanceof Error ? error.message : "Brief confirmation error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // Read-only lookup (host CRM/tooling): GET /api/fartak/brief?briefId=...
  const briefId = new URL(req.url).searchParams.get("briefId") || "";
  if (!briefId) return NextResponse.json({ error: "Missing briefId" }, { status: 400 });
  const brief = await getBrief(briefId);
  if (!brief) return NextResponse.json({ error: "Brief not found" }, { status: 404 });
  return NextResponse.json({ ok: true, brief });
}
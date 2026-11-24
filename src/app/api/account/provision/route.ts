export const dynamic = "force-dynamic";

export async function POST() {
  // Intentionally not wired to the fixture-tested service. Live activation is
  // a separately reviewed change after provider/recovery/eligibility gates.
  return Response.json({ code: "provisioning_unavailable" }, { status: 503,
    headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

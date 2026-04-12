// Temporary debug endpoint — remove after diagnosing Reminders discovery
// GET /api/debug/reminders
// Returns raw PROPFIND response and parsed list results

import { NextRequest, NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth";
import { calFetch, discoverHomeUrl } from "@/lib/caldav/client";

export async function GET(req: NextRequest) {
  if (!authenticateUser(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const homeUrl = await discoverHomeUrl();

    const res = await calFetch(homeUrl, "PROPFIND", {
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
      Accept: "application/xml",
    }, `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <c:supported-calendar-component-set/>
  </d:prop>
</d:propfind>`);

    const rawXml = await res.text();
    const status = res.status;

    // Parse all response blocks and tag them
    const blocks = rawXml.match(/<[A-Za-z0-9]*:?response[\s\S]*?<\/[A-Za-z0-9]*:?response>/g) ?? [];
    const parsed = blocks.map((block) => {
      const hrefMatch = block.match(/<[A-Za-z0-9]*:?href[^>]*>([^<]+)<\/[A-Za-z0-9]*:?href>/i);
      const nameMatch = block.match(/<[A-Za-z0-9]*:?displayname[^>]*>([^<]*)<\/[A-Za-z0-9]*:?displayname>/i);
      const hasVTODO = block.toLowerCase().includes("vtodo");
      const hasVEVENT = block.toLowerCase().includes("vevent");
      return {
        href: hrefMatch?.[1]?.trim() ?? "(none)",
        displayName: nameMatch?.[1]?.trim() ?? "(empty)",
        hasVTODO,
        hasVEVENT,
      };
    });

    return NextResponse.json({
      homeUrl,
      propfindStatus: status,
      collectionCount: blocks.length,
      collections: parsed,
      rawXml,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

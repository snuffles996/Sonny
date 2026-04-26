// GET /api/recipes/photo?src=<encoded-blob-url>
// Proxies private Vercel Blob images so they can be displayed in <img> tags.
// No auth check — the blob URL embedded in `src` is a non-guessable capability URL
// only reachable through the authenticated recipe API.
import { NextRequest, NextResponse } from "next/server";

const BLOB_HOST = "blob.vercel-storage.com";

export async function GET(req: NextRequest) {

  const src = req.nextUrl.searchParams.get("src");
  if (!src) return new NextResponse("src required", { status: 400 });

  let blobUrl: URL;
  try { blobUrl = new URL(src); } catch {
    return new NextResponse("invalid src", { status: 400 });
  }
  if (!blobUrl.hostname.endsWith(BLOB_HOST)) {
    return new NextResponse("invalid src", { status: 400 });
  }

  const res = await fetch(src, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
  });

  if (!res.ok) return new NextResponse("not found", { status: 404 });

  return new NextResponse(res.body, {
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

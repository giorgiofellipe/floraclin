import { indexNowKey } from "@/lib/indexnow";

// Served at /{INDEXNOW_KEY}.txt through the rewrite in next.config.ts, and
// read by scripts/indexnow-ping.mjs to learn the key without a CI secret.
export const dynamic = "force-static";

export function GET() {
  const key = indexNowKey();
  // Empty 200 when IndexNow is off, so the ping script can tell "off" apart
  // from an older deploy that has no such route yet (404).
  return new Response(key ?? "", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex",
    },
  });
}

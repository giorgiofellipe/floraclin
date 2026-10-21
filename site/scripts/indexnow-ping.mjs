#!/usr/bin/env node
// Pings IndexNow (api.indexnow.org, shared by Bing, Yandex and others) with
// every URL in the live production sitemap.
//
// Runs from .github/workflows/indexnow.yml after a floraclin-site production
// deploy, or by hand: `node site/scripts/indexnow-ping.mjs`.
// It only ever talks to the production host, so it can't ping for a preview.
// The key is read from the live site (/indexnow-key), so CI needs no secret;
// if the site has no INDEXNOW_KEY, IndexNow is off and this exits 0.

const SITE = "https://floraclin.com.br";
const HOST = new URL(SITE).host;
const ENDPOINT = "https://api.indexnow.org/indexnow";
const ATTEMPTS = 6;
const RETRY_MS = 20_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url) {
  const res = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  return { status: res.status, text: await res.text() };
}

async function withRetry(label, fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= ATTEMPTS) throw error;
      console.log(`${label}: ${error.message}; retrying in ${RETRY_MS / 1000}s (${attempt}/${ATTEMPTS})`);
      await sleep(RETRY_MS);
    }
  }
}

async function main() {
  const keyRes = await withRetry("key", async () => {
    const res = await fetchText(`${SITE}/indexnow-key`);
    if (res.status !== 200 && res.status !== 404) throw new Error(`GET /indexnow-key returned ${res.status}`);
    return res;
  });
  if (keyRes.status === 404) {
    console.log("INDEXNOW_KEY is not set on the site; IndexNow is off. Nothing to do.");
    return;
  }
  const key = keyRes.text.trim();
  const keyLocation = `${SITE}/${key}.txt`;

  // The key file must be live before the engines check it.
  await withRetry("key file", async () => {
    const res = await fetchText(keyLocation);
    if (res.status !== 200 || res.text.trim() !== key) throw new Error(`${keyLocation} returned ${res.status}`);
  });

  const urlList = await withRetry("sitemap", async () => {
    const res = await fetchText(`${SITE}/sitemap.xml`);
    if (res.status !== 200) throw new Error(`sitemap.xml returned ${res.status}`);
    const urls = [...res.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
      .map((match) => match[1])
      .filter((url) => new URL(url).host === HOST);
    if (urls.length === 0) throw new Error("sitemap.xml has no URLs");
    return urls;
  });

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key, keyLocation, urlList }),
  });
  const body = await res.text();
  console.log(`IndexNow answered ${res.status} for ${urlList.length} URLs${body ? `: ${body.slice(0, 300)}` : ""}`);
  urlList.forEach((url) => console.log(`  ${url}`));
  // 200 = accepted, 202 = accepted, key validation pending.
  if (res.status !== 200 && res.status !== 202) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

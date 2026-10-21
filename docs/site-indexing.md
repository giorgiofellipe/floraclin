# floraclin.com.br indexing

How the marketing site (`site/`, Vercel project `floraclin-site`) tells search engines and AI crawlers about its pages.

## Page registry

`site/src/lib/site-pages.ts` lists every public, indexable page with its last-change date (`updated`, a BR calendar day). The sitemap (`/sitemap.xml`), `/llms.txt` and the IndexNow ping are all built from it.

When you add a page, add it to `SITE_PAGES` and bump `updated` whenever its content changes. `site-pages.test.ts` fails if a page file under `src/app` is in neither `SITE_PAGES` nor `NON_INDEXABLE_ROUTES` (for internal pages like `/motion-lab`; by convention those also set `robots: { index: false }`, which the test doesn't check). Dynamic routes (`[slug]`) make the test fail on purpose: they need a registry entry generated from their data source before they can be listed.

## IndexNow (Bing, Yandex and other participating engines)

- Key: `INDEXNOW_KEY` on floraclin-site, Production only: 8–128 characters of `[A-Za-z0-9-]` (e.g. `openssl rand -hex 16`). It is public by design. When it's unset or malformed, IndexNow is off: `/indexnow-key` answers an empty 200, `/{key}.txt` returns 404, and the ping does nothing.
- Key file: `/{INDEXNOW_KEY}.txt` (a rewrite in `site/next.config.ts` to `/indexnow-key`).
- Ping: `.github/workflows/indexnow.yml` runs `site/scripts/indexnow-ping.mjs` when Vercel reports a successful **Production – floraclin-site** deployment to GitHub. Preview deployments never match, and the script only ever submits `https://floraclin.com.br` URLs read from the live sitemap. It retries (up to 6 attempts, 20 s apart, per step) while the key route, key file or sitemap answers with an error (a 404 from `/indexnow-key` means the old deploy is still live), and on 429 or 5xx from IndexNow. It then submits the full URL list (the site has only a handful of pages) to `https://api.indexnow.org/indexnow` and fails unless the answer is 200 or 202. Every deployment status Vercel reports (previews, the web app) starts a run, so skipped IndexNow runs in the Actions list are expected.
- After a deploy that didn't trigger the workflow (for example a CLI deploy, which doesn't report to GitHub), run it from GitHub: Actions → IndexNow → Run workflow, or `gh workflow run indexnow.yml`. Running `node site/scripts/indexnow-ping.mjs` locally works too.
- To rotate the key, change `INDEXNOW_KEY` and redeploy. The rewrite is generated at build time.

## Copy that repeats prices

`site/src/lib/llms.ts` repeats the plan prices and trial length shown in `pricing.tsx`, `faq.tsx`, `structured-data.tsx` and `public/llms-full.txt`. Update all of them together.

## Search console verification

`GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` on floraclin-site (Production) render `<meta name="google-site-verification">` and `<meta name="msvalidate.01">` on every page, only when set. Paste only the `content` value, not the whole tag. They are read at build time, so redeploy after setting them.

floraclin.com.br's DNS is on Vercel (nameservers ns1/ns2.vercel-dns.com, per the Vercel domain settings), so a DNS TXT record from the Vercel dashboard (Domains → floraclin.com.br → DNS Records) is an alternative. Google's "Domain" property type needs the TXT record and covers app.floraclin.com.br too.

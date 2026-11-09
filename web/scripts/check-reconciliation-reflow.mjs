// Run against the isolated local QA app with TEST_AUTH_BYPASS_ENABLED.
// This read-only browser check mocks statement responses; it never writes data.
// BASE_URL=http://127.0.0.1:3164 node scripts/check-reconciliation-reflow.mjs
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3164'
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a local QA app')
const output = process.env.REFLOW_OUTPUT ?? '/tmp/floraclin-reconciliation-reflow'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const results = []
try {
  for (const width of [320, 375, 1280]) {
    for (const scale of [100, 200]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        extraHTTPHeaders: { 'x-test-user-id': '00000000-0000-4000-a000-000000000001' },
      })
      const page = await context.newPage()
      await page.route('**/api/financial/reconciliation/lines?*', async route => {
        const common = { accountId: 'fixture', importId: 'fixture', postedDate: '2026-11-09',
          fitid: 'fixture', trnType: 'CREDIT', suspectReviewedAt: null, ignoredAt: null,
          ignoreReason: null, allocatedCents: 0, status: 'open', allocations: [] }
        await route.fulfill({ json: { data: { hasMore: false, lines: [
          { ...common, id: 'credit', memo: 'PIX Maria Silva', amountCents: 25000, suspectedDuplicateOf: null },
          { ...common, id: 'debit', memo: 'TARIFA BANCÁRIA', amountCents: -123456789,
            suspectedDuplicateOf: 'older-line' },
        ] } } })
      })
      await page.goto(`${base}/financeiro?tab=reconciliation`, { waitUntil: 'domcontentloaded' })
      await page.getByTestId('statement-line').first().waitFor()
      const refuse = page.getByRole('button', { name: 'Recusar', exact: true })
      if (await refuse.isVisible()) await refuse.click()
      const dismiss = page.getByTestId('install-banner').getByRole('button', { name: 'Fechar', exact: true })
      if (await dismiss.isVisible()) await dismiss.click()
      await page.addStyleTag({ content: `html{font-size:${scale}%}` })
      await page.evaluate(async () => { await document.fonts.ready })
      await page.waitForTimeout(1000)
      const result = await page.getByTestId('reconciliation-view').evaluate(root => {
        const rect = root.getBoundingClientRect()
        const clipped = [...root.querySelectorAll('[data-testid="statement-line"]')].flatMap(row => {
          const bounds = row.getBoundingClientRect()
          return [...row.querySelectorAll('td,button')].filter(e => {
            const r = e.getBoundingClientRect()
            return e.scrollWidth > e.clientWidth + 1 || r.left < bounds.left - 1 || r.right > bounds.right + 1
          }).map(e => ({ text: e.textContent, width: e.clientWidth, scroll: e.scrollWidth }))
        })
        return { documentWidth: document.documentElement.scrollWidth, viewport: innerWidth,
          headerRight: document.querySelector('[data-testid=header]').lastElementChild.getBoundingClientRect().right,
          rootWidth: root.clientWidth, rootScroll: root.scrollWidth, right: rect.right, clipped }
      })
      results.push({ width, scale, ...result })
      await page.screenshot({ path: `${output}/fixture-${width}-${scale}.png`, fullPage: true })
      assert(result.headerRight <= width, 'Header actions extend beyond the viewport')
      assert(result.right <= width, 'Reconciliation view extends beyond the viewport')
      assert(result.rootScroll <= result.rootWidth, 'Reconciliation view overflows')
      assert.deepEqual(result.clipped, [], 'Statement cells or buttons clip their content')
      // The shared app shell is measured separately so unrelated header/tab
      // overflow cannot hide a regression inside the reconciliation cards.
      await context.close()
    }
  }
} finally {
  await writeFile(`${output}/measurements.json`, JSON.stringify(results, null, 2))
  await browser.close()
}
console.log(JSON.stringify(results, null, 2))

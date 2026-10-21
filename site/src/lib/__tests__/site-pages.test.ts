import { describe, it, expect } from 'vitest'
import { readdirSync } from 'fs'
import path from 'path'
import sitemap from '@/app/sitemap'
import { NON_INDEXABLE_ROUTES, SITE_PAGES } from '@/lib/site-pages'
import { buildLlmsTxt } from '@/lib/llms'

const APP_DIR = path.resolve(__dirname, '../../app')

/** Route paths of every page.tsx under src/app (route groups stripped). */
function appRoutes(dir = APP_DIR, segments: string[] = []): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isFile()) return entry.name === 'page.tsx' ? ['/' + segments.join('/')] : []
    if (!entry.isDirectory()) return []
    const isGroup = entry.name.startsWith('(') && entry.name.endsWith(')')
    return appRoutes(path.join(dir, entry.name), isGroup ? segments : [...segments, entry.name])
  })
}

describe('site page registry', () => {
  it('lists every page under src/app, unless it is marked non-indexable', () => {
    const listed = new Set([...SITE_PAGES.map((p) => p.path), ...NON_INDEXABLE_ROUTES])
    const missing = appRoutes().filter((route) => !listed.has(route))
    expect(missing).toEqual([])
  })

  it('has no stale entries for pages that no longer exist', () => {
    const routes = new Set(appRoutes())
    expect(SITE_PAGES.map((p) => p.path).filter((p) => !routes.has(p))).toEqual([])
  })

  it('builds the sitemap from the registry with a lastModified per page', () => {
    const entries = sitemap()
    expect(entries.map((e) => e.url)).toContain('https://floraclin.com.br/lgpd')
    expect(entries).toHaveLength(SITE_PAGES.length)
    expect(entries.every((e) => e.lastModified instanceof Date && !Number.isNaN(e.lastModified.getTime()))).toBe(true)
  })

  it('keeps non-indexable routes out of the sitemap', () => {
    const urls = sitemap().map((e) => e.url)
    expect(urls.some((u) => u.endsWith('/motion-lab'))).toBe(false)
  })

  it('links every registered page from llms.txt', () => {
    const txt = buildLlmsTxt()
    for (const page of SITE_PAGES) {
      const url = page.path === '/' ? 'https://floraclin.com.br' : `https://floraclin.com.br${page.path}`
      expect(txt).toContain(`](${url})`)
    }
  })
})

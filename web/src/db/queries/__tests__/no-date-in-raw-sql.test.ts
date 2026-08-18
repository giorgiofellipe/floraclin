import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Guards a failure mode that no ordinary unit test can catch.
 *
 * postgres.js (the driver behind `db` / drizzle) cannot serialize a JS
 * `Date` interpolated into a raw `sql` template literal. It throws at
 * runtime:
 *
 *   ERR_INVALID_ARG_TYPE: The "string" argument must be of type string or
 *   an instance of Buffer or ArrayBuffer. Received an instance of Date
 *
 * Drizzle's typed operators (`gte`, `lte`, `eq`, ...) serialize `Date`
 * correctly — only *raw* `sql` fragments break, and only when a `Date` is
 * interpolated directly (`${windowEnd}` / `${windowEnd}::timestamptz`).
 * The fix is always to call `.toISOString()` before interpolating.
 *
 * Every existing test around these queries mocks `db`, so the postgres.js
 * driver never actually runs and the `Date` is never serialized — a unit
 * test with a mocked db cannot catch this class of bug. That is exactly
 * how `getAppointmentsPendingConfirmation` / `...Until` shipped broken:
 * appointment confirmations silently failed for every tenant.
 *
 * This test reads the raw source of every raw-`sql` call site off disk and
 * statically flags `${...}` interpolations that look like they carry a
 * `Date`, instead of relying on a live DB round-trip.
 *
 * ── Heuristic (sound, not complete) ─────────────────────────────────────
 * We cannot know real types without a type checker, so we approximate:
 *
 *   1. Find every `` sql`...` `` (and `` sql<T>`...` ``) tagged template.
 *   2. Extract its top-level `${...}` interpolations.
 *   3. An interpolation is FLAGGED if:
 *        a) it's an inline call that starts with a known Date-producing
 *           constructor (`new Date(`, `endOfBrDay(`, `startOfBrDay(`,
 *           `parseBrDate(`, `parseLocalDate(`, `addDays(`, `subDays(`,
 *           `startOfMonth(`, `endOfMonth(`, `startOfWeek(`, `endOfWeek(`),
 *           OR
 *        b) its leading identifier (e.g. `windowEnd` in `windowEnd` or in
 *           `windowEnd.foo()`) is declared earlier in the *same file* via
 *           `const/let/var NAME = <one of the constructors above>(...)`.
 *   4. An interpolation is NEVER flagged if it ends in `.toISOString()`
 *      (the documented escape hatch) — this must come before rule 3.
 *
 * ── Known limits (by design, not bugs) ──────────────────────────────────
 *   - Purely syntactic. It does not resolve imports or run a type checker,
 *     so it cannot see through re-exports, renamed imports, or values that
 *     cross file boundaries (e.g. a Date passed in as a function argument
 *     from another file). It only catches the *local, same-file*
 *     `const x = new Date(...)` pattern that caused this bug.
 *   - Only `.toISOString()` is treated as a safe escape, exactly as
 *     specified. A variable used as `${windowEnd.getTime()}` (a *number*,
 *     actually safe) is still flagged — a false positive, but a
 *     deliberately conservative one.
 *   - Brace-depth tracking (not real JS parsing) locates the end of a
 *     template literal and of each `${...}`. It can be fooled by a stray
 *     unbalanced `{`/`}` inside a *string literal* written inside an
 *     interpolation. No such case exists in this codebase today.
 *   - Column references (`${appointments.date}`) and plain string
 *     variables (`${today}` where `today = brToday()`) are correctly
 *     *not* flagged, because their declarations don't match a
 *     Date-producing constructor.
 */

const SRC = path.resolve(__dirname, '../../..')

/** Directories that contain (or have contained) raw `sql` fragments. */
const SCAN_DIRS = ['db/queries', 'app/api', 'lib']

const DATE_PRODUCING_CALLS = [
  'new Date(',
  'endOfBrDay(',
  'startOfBrDay(',
  'parseBrDate(',
  'parseLocalDate(',
  'addDays(',
  'subDays(',
  'startOfMonth(',
  'endOfMonth(',
  'startOfWeek(',
  'endOfWeek(',
]

interface SqlTemplate {
  content: string
  contentStart: number
}

interface Interpolation {
  expr: string
  offset: number
}

interface Violation {
  file: string
  line: number
  expr: string
}

/** Finds every `sql\`...\`` / `sql<T>\`...\`` tagged template in `source`. */
function findSqlTemplates(source: string): SqlTemplate[] {
  const templates: SqlTemplate[] = []
  const tagRe = /\bsql(?:<[^>\n]*>)?`/g
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(source)) !== null) {
    const contentStart = m.index + m[0].length
    let i = contentStart
    let depth = 0 // brace depth, only meaningful while inside a ${...}
    while (i < source.length) {
      const ch = source[i]
      if (ch === '\\') {
        i += 2
        continue
      }
      if (depth === 0) {
        if (ch === '`') break
        if (ch === '$' && source[i + 1] === '{') {
          depth = 1
          i += 2
          continue
        }
        i++
      } else {
        if (ch === '{') depth++
        else if (ch === '}') depth--
        i++
      }
    }
    templates.push({ content: source.slice(contentStart, i), contentStart })
    tagRe.lastIndex = i + 1
  }
  return templates
}

/** Extracts the top-level `${...}` interpolations from a template's content. */
function findInterpolations(template: SqlTemplate): Interpolation[] {
  const { content, contentStart } = template
  const results: Interpolation[] = []
  let i = 0
  while (i < content.length) {
    const ch = content[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '$' && content[i + 1] === '{') {
      const start = i + 2
      let depth = 1
      let j = start
      while (j < content.length && depth > 0) {
        const c = content[j]
        if (c === '\\') {
          j += 2
          continue
        }
        if (c === '{') depth++
        else if (c === '}') {
          depth--
          if (depth === 0) break
        }
        j++
      }
      results.push({ expr: content.slice(start, j), offset: contentStart + start })
      i = j + 1
      continue
    }
    i++
  }
  return results
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True if `name` is declared in `source` via a known Date-producing call. */
function isLocallyDateProducing(name: string, source: string): boolean {
  const declRe = new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\b[^=\\n]*=\\s*([^\\n;]+)`)
  const m = declRe.exec(source)
  if (!m) return false
  const init = m[1].trim()
  // Already converted to a string at the declaration site (e.g.
  // `const x = endOfBrDay(d).toISOString()`) — not a Date by the time it
  // reaches the interpolation.
  if (/\.toISOString\(\)\s*$/.test(init)) return false
  return DATE_PRODUCING_CALLS.some((call) => init.includes(call))
}

/** Classifies one interpolation expression against a file's source. Returns
 * a human-readable reason string if it should be flagged, else null. */
function classifyInterpolation(expr: string, source: string): string | null {
  const trimmed = expr.trim()

  // Explicit, documented escape hatch.
  if (/\.toISOString\(\)\s*$/.test(trimmed)) return null

  // Inline construction: ${new Date(...)}, ${endOfBrDay(...)}, etc.
  const inlineHit = DATE_PRODUCING_CALLS.find((call) => trimmed.startsWith(call))
  if (inlineHit) return `inline ${inlineHit.replace(/\($/, '(...)')} without .toISOString()`

  // Variable reference: ${windowEnd} / ${windowEnd.foo()} where `windowEnd`
  // was declared in this same file from a known Date-producing call.
  const idMatch = trimmed.match(/^[A-Za-z_$][A-Za-z0-9_$]*/)
  if (!idMatch) return null
  const name = idMatch[0]
  if (isLocallyDateProducing(name, source)) {
    return `'${name}' is assigned from a Date-producing call in this file, interpolated without .toISOString()`
  }
  return null
}

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length
}

function scanFile(absPath: string): Violation[] {
  const source = fs.readFileSync(absPath, 'utf8')
  const violations: Violation[] = []
  for (const template of findSqlTemplates(source)) {
    for (const { expr, offset } of findInterpolations(template)) {
      const reason = classifyInterpolation(expr, source)
      if (reason) {
        violations.push({
          file: path.relative(SRC, absPath),
          line: lineOf(source, offset),
          expr: `\${${expr.trim()}} — ${reason}`,
        })
      }
    }
  }
  return violations
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function collectScanFiles(): string[] {
  const files: string[] = []
  for (const dir of SCAN_DIRS) {
    walk(path.join(SRC, dir), files)
  }
  return files
}

describe('raw sql templates never interpolate a Date', () => {
  const files = collectScanFiles()

  it('found source files to scan (sanity check the scan isn\'t vacuous)', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it.each(files.map((f) => path.relative(SRC, f)))('%s has no raw Date interpolation', (relFile) => {
    const violations = scanFile(path.join(SRC, relFile))
    expect(violations).toEqual([])
  })

  it('detects a Date interpolated into a raw sql template (guards the guard)', () => {
    // Mirrors the exact shape of the bug that shipped: a local `const`
    // built from `endOfBrDay(...)` interpolated straight into `sql` with
    // no `.toISOString()`. If this ever comes back empty, the scanner has
    // gone blind.
    const fixture = `
      import { endOfBrDay } from '@/lib/dates'
      export async function broken(tenantId: string) {
        const windowEnd = endOfBrDay('2026-04-13')
        return db.select().from(appointments).where(
          sql\`\${appointments.date} <= \${windowEnd}::timestamptz\`
        )
      }
    `
    const violations: Violation[] = []
    for (const template of findSqlTemplates(fixture)) {
      for (const { expr, offset } of findInterpolations(template)) {
        const reason = classifyInterpolation(expr, fixture)
        if (reason) violations.push({ file: 'fixture', line: lineOf(fixture, offset), expr })
      }
    }
    expect(violations).toHaveLength(1)
    expect(violations[0].expr.trim()).toBe('windowEnd')

    // Same fixture, but with the fix applied — must NOT be flagged.
    const fixed = fixture.replace('${windowEnd}::timestamptz', '${windowEnd.toISOString()}::timestamptz')
    const fixedViolations: Violation[] = []
    for (const template of findSqlTemplates(fixed)) {
      for (const { expr } of findInterpolations(template)) {
        const reason = classifyInterpolation(expr, fixed)
        if (reason) fixedViolations.push({ file: 'fixture', line: 0, expr })
      }
    }
    expect(fixedViolations).toEqual([])
  })
})

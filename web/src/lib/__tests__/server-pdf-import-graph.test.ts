import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Guards a failure mode that no ordinary unit test can catch.
 *
 * The PDF documents below are rendered with `renderToStaticMarkup` inside
 * route handlers — i.e. on the server, under React's `react-server`
 * condition. When server code imports from a `'use client'` module, Next
 * does not give it the real values: each export becomes a client
 * *reference* stub that throws the moment it is read or called
 * (`Cannot access X.Y on the server. You cannot dot into a client module
 * from a server component.`). The route's `catch` turns that into an
 * opaque 500.
 *
 * Vitest renders these components with no RSC transform at all, so a
 * component test happily passes against the real module while the deployed
 * build throws — which is exactly how `/api/reports/prontuario?format=pdf`
 * shipped broken. This test reads the import graph off disk instead, so it
 * sees what the bundler sees.
 */

const SRC = path.resolve(__dirname, '../..')

/** Entry points whose React tree is rendered server-side into a PDF. */
const SERVER_PDF_ENTRIES = [
  'components/reports/prontuario-pdf.tsx',
  'components/reports/report-pdf.tsx',
  'components/consent/print-consent.tsx',
  'components/clinical-documents/print-document.tsx',
  'lib/pdf.ts',
  'lib/pdf-branding.tsx',
]

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']

function resolveModule(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else return null // bare package specifier — not ours to police

  for (const ext of EXTENSIONS) {
    if (fs.existsSync(base + ext)) return base + ext
  }
  for (const ext of EXTENSIONS) {
    const idx = path.join(base, 'index' + ext)
    if (fs.existsSync(idx)) return idx
  }
  return null
}

/** Matches a leading `'use client'` directive, skipping comments and blanks. */
const USE_CLIENT = /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*['"]use client['"]/

/** Non-type-only static imports and re-exports. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = []
  const re = /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)from\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const clause = m[1]
    // `import type {...} from` / `export type {...} from` are erased at
    // compile time and never produce a client reference.
    if (/^\s*type\s/.test(clause)) continue
    specs.push(m[2])
  }
  return specs
}

function collectClientImports(entry: string): string[] {
  const violations: string[] = []
  const seen = new Set<string>()
  const queue = [path.join(SRC, entry)]

  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)

    const source = fs.readFileSync(file, 'utf8')
    if (file !== path.join(SRC, entry) && USE_CLIENT.test(source)) {
      violations.push(path.relative(SRC, file))
      // Don't descend: everything under a client module is legitimately
      // client code. The boundary itself is the violation.
      continue
    }

    for (const spec of importSpecifiers(source)) {
      const resolved = resolveModule(spec, file)
      if (resolved) queue.push(resolved)
    }
  }

  return violations
}

describe('server-rendered PDF components', () => {
  it.each(SERVER_PDF_ENTRIES)('%s does not import any \'use client\' module', (entry) => {
    expect(fs.existsSync(path.join(SRC, entry))).toBe(true)
    expect(collectClientImports(entry)).toEqual([])
  })

  it('detects a violation when one exists (guards the guard)', () => {
    // `face-diagram-editor.tsx` is a client component that imports
    // `face-template.tsx` (`'use client'`), so the walker must flag it.
    // If this ever comes back empty the check above has gone blind.
    expect(collectClientImports('components/face-diagram/face-diagram-editor.tsx')).toContain(
      'components/face-diagram/face-template.tsx',
    )
  })
})

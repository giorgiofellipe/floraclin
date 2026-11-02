import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button, buttonVariants } from '../button'

const GLOBALS_CSS = readFileSync(path.resolve(__dirname, '../../../app/globals.css'), 'utf8')

/** The value of a `--color-*` token in globals.css, if there is one. */
function token(name: string): string | undefined {
  return GLOBALS_CSS.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The colour token behind a variant's `<prefix>-<token>` class (`text-sm` and the like are skipped). */
function variantToken(classes: string, prefix: string): string {
  for (const match of classes.matchAll(new RegExp(`(?:^|\\s)${prefix}-([a-z]+)(?=\\s|$)`, 'g'))) {
    const hex = token(match[1])
    if (hex) return hex
  }
  throw new Error(`no ${prefix}-<colour token> in ${classes}`)
}

describe('Button', () => {
  it('is brand green by default, sage on hover, with cream text', () => {
    render(<Button>Salvar</Button>)
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveClass('bg-forest', 'text-cream', 'hover:bg-sage')
  })

  it('keeps WCAG AA contrast (4.5:1) for the text at rest and on hover', () => {
    // Read from the variant itself, so a recolour to an unreadable pair fails here too.
    const classes = buttonVariants()
    const text = variantToken(classes, 'text')
    expect(contrast(text, variantToken(classes, 'bg'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(text, variantToken(classes, 'hover:bg'))).toBeGreaterThanOrEqual(4.5)
  })
})

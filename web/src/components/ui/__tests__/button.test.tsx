import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button, buttonVariants } from '../button'

/** The value of a `--color-*` token in globals.css. */
function token(name: string): string {
  const css = readFileSync(path.resolve(__dirname, '../../../app/globals.css'), 'utf8')
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!match) throw new Error(`no --color-${name}`)
  return match[1]
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

describe('Button', () => {
  it('is brand green by default, sage on hover, with cream text', () => {
    render(<Button>Salvar</Button>)
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveClass('bg-forest', 'text-cream', 'hover:bg-sage')
  })

  it('keeps WCAG AA contrast (4.5:1) for the text at rest and on hover', () => {
    expect(contrast(token('cream'), token('forest'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('cream'), token('sage'))).toBeGreaterThanOrEqual(4.5)
  })

  it('leaves the other variants alone', () => {
    for (const variant of ['outline', 'secondary', 'ghost', 'destructive', 'link'] as const) {
      expect(buttonVariants({ variant })).not.toMatch(/\bbg-forest\b/)
    }
    expect(buttonVariants({ variant: 'destructive' })).toMatch(/\bbg-destructive\/10\b/)
    expect(buttonVariants({ variant: 'outline' })).toMatch(/\bbg-background\b/)
  })

  it('still lets a caller override the colour', () => {
    render(<Button className="bg-[#25D366] text-white hover:bg-[#1DA851]">WhatsApp</Button>)
    const button = screen.getByRole('button', { name: 'WhatsApp' })
    expect(button).toHaveClass('bg-[#25D366]', 'text-white', 'hover:bg-[#1DA851]')
    expect(button).not.toHaveClass('bg-forest', 'text-cream', 'hover:bg-sage')
  })
})

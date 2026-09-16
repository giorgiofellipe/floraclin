import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '../manifest'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// Width and height live in the IHDR chunk right after the 8 byte signature and
// the 8 byte chunk header, so no image library is needed to read them.
function pngSize(file: string) {
  const buf = readFileSync(file)
  expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`
}

describe('manifest', () => {
  const m = manifest()

  it('declares the app identity, colors and a standalone start on the dashboard', () => {
    expect(m.start_url).toBe('/dashboard')
    expect(m.display).toBe('standalone')
    expect(m.name).toBe('FloraClin')
    expect(m.short_name).toBe('FloraClin')
    expect(m.lang).toBe('pt-BR')
    expect(m.theme_color).toBe('#1C2B1E')
    expect(m.background_color).toBe('#FFFFFF')
  })

  it('declares 192, 512 and a maskable 512 PNG icon', () => {
    const icons = m.icons ?? []
    expect(icons).toHaveLength(3)
    expect(icons.map((i) => i.sizes)).toEqual(['192x192', '512x512', '512x512'])
    expect(icons.every((i) => i.type === 'image/png')).toBe(true)
    expect(icons.filter((i) => i.purpose === 'maskable')).toHaveLength(1)
  })

  it('points every icon at a PNG in public/ with the declared size', () => {
    for (const icon of m.icons ?? []) {
      expect(pngSize(path.join(process.cwd(), 'public', icon.src))).toBe(icon.sizes)
    }
  })

  it('ships a 180x180 PNG touch icon for iOS', () => {
    expect(pngSize(path.join(process.cwd(), 'src/app/apple-icon.png'))).toBe('180x180')
  })
})

import { createHash } from 'node:crypto'

import { normalizeBrPhone } from '@/lib/phone'

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function hashEmail(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized ? sha256Hex(normalized) : undefined
}

/**
 * Meta wants E.164 digits with no plus sign. `normalizeBrPhone` already
 * produces exactly that (55 + DDD + subscriber), and routing both patient
 * records and Meta's own `from` field through it is what makes the two
 * collapse to the same digest.
 */
export function hashPhone(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const canonical = normalizeBrPhone(value)
  return canonical ? sha256Hex(canonical) : undefined
}

export function hashName(value: string | null | undefined): string | undefined {
  const normalized = value
    ?.normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
  return normalized ? sha256Hex(normalized) : undefined
}

export function splitFullName(
  fullName: string | null | undefined,
): { first?: string; last?: string } {
  const parts = fullName?.trim().split(/\s+/).filter(Boolean) ?? []
  if (parts.length === 0) return {}
  if (parts.length === 1) return { first: parts[0] }
  return { first: parts[0], last: parts[parts.length - 1] }
}

/**
 * Deterministic patient identities for the Clínica Lumé demo seed.
 *
 * Every value here is generated from a numeric index or seed, never from
 * `Math.random()` or the wall clock, so re-running the seed against the same
 * inputs produces the same CPFs, phones and emails. That keeps the seed
 * idempotent: a re-run replaces the same rows instead of drifting.
 */

import { toBrYmd } from '@/lib/dates'
import { EMAIL_DOMAIN, PHONE_PREFIX } from './config'
import type { SeededPatient } from './types'

/**
 * Small deterministic PRNG (mulberry32). Not cryptographic, just a fast,
 * dependency-free way to turn an integer seed into a reproducible stream of
 * floats in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let a = seed | 0
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Standard Brazilian CPF check-digit algorithm. `digits` holds either the 9
 * base digits (weights 10..2) or the base plus the first check digit (10
 * digits, weights 11..2) -- the weight range is derived from the length so
 * the same function serves both passes.
 */
function cpfCheckDigit(digits: number[]): number {
  const weightStart = digits.length + 1
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    sum += digits[i] * (weightStart - i)
  }
  const remainder = sum % 11
  return remainder < 2 ? 0 : 11 - remainder
}

/**
 * Generates a formatted, check-digit-valid CPF from a numeric seed. The
 * same seed always produces the same CPF. Repdigit bases (000000000,
 * 111111111, ...) are rejected and re-rolled since real-world validators
 * treat them as invalid despite passing the checksum.
 */
export function generateCpf(seed: number): string {
  const rng = mulberry32(seed)
  let base: number[]
  do {
    base = Array.from({ length: 9 }, () => Math.floor(rng() * 10))
  } while (base.every((d) => d === base[0]))

  const d10 = cpfCheckDigit(base)
  const d11 = cpfCheckDigit([...base, d10])
  const all = [...base, d10, d11].join('')

  return `${all.slice(0, 3)}.${all.slice(3, 6)}.${all.slice(6, 9)}-${all.slice(9, 11)}`
}

/**
 * Generates an unroutable phone number by appending a zero-padded index to
 * the safe prefix. Never collides across a run because it is a pure
 * function of `index`.
 */
export function generatePhone(index: number): string {
  return `${PHONE_PREFIX}${String(index).padStart(3, '0')}`
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function slugify(value: string): string {
  return stripAccents(value).toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * Builds a `nome.sobrenome@example.com` address from a full name, stripping
 * accents and lowercasing. `taken` tracks addresses already handed out in
 * this run; on collision a numeric suffix is appended (and the caller's
 * `taken` set is used to remember the pick, so pass the same set across a
 * whole seed run).
 */
export function generateEmail(fullName: string, taken: Set<string>): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  const first = slugify(parts[0] ?? 'paciente')
  const last = slugify(parts[parts.length - 1] ?? 'demo')
  const base = `${first}.${last}` || 'paciente.demo'

  let candidate = `${base}@${EMAIL_DOMAIN}`
  let suffix = 2
  while (taken.has(candidate)) {
    candidate = `${base}${suffix}@${EMAIL_DOMAIN}`
    suffix += 1
  }
  taken.add(candidate)
  return candidate
}

/**
 * Distributes `count` items across `ratios` so that at every prefix length
 * the running counts stay as close as possible to their target share. This
 * is the standard largest-remainder / Bresenham-style proportional
 * allocation: at each step it assigns the category currently furthest
 * below its target, which keeps small samples (like 50 patients) close to
 * the requested percentages instead of drifting on rounding.
 */
function proportionalAssignment<T extends string>(
  count: number,
  ratios: Array<{ key: T; ratio: number }>,
): T[] {
  const counts = new Map<T, number>(ratios.map((r) => [r.key, 0]))
  const result: T[] = []

  for (let i = 0; i < count; i++) {
    let best = ratios[0].key
    let bestDeficit = -Infinity
    for (const r of ratios) {
      const deficit = r.ratio * (i + 1) - (counts.get(r.key) ?? 0)
      if (deficit > bestDeficit) {
        bestDeficit = deficit
        best = r.key
      }
    }
    counts.set(best, (counts.get(best) ?? 0) + 1)
    result.push(best)
  }

  return result
}

const FEMALE_FIRST_NAMES = [
  'Maria', 'Ana', 'Fernanda', 'Juliana', 'Camila', 'Beatriz', 'Larissa',
  'Gabriela', 'Amanda', 'Bruna', 'Carolina', 'Débora', 'Patrícia', 'Renata',
  'Vanessa', 'Aline', 'Priscila', 'Mariana', 'Letícia', 'Rafaela', 'Isabela',
  'Natália', 'Tatiane', 'Cristina', 'Adriana', 'Simone', 'Vivian', 'Luciana',
  'Daniela', 'Michele', 'Sabrina', 'Jéssica', 'Paula', 'Tainá', 'Yasmin',
  'Raquel', 'Sônia', 'Fabiana', 'Elaine', 'Cíntia', 'Talita', 'Nayara',
]

const MALE_FIRST_NAMES = [
  'João', 'Pedro', 'Lucas', 'Rafael', 'Marcelo', 'Gustavo', 'Rodrigo',
  'Bruno', 'Felipe', 'Thiago', 'André', 'Diego', 'Eduardo', 'Vinícius',
  'Leonardo', 'Fábio', 'Ricardo', 'Alexandre', 'Renato', 'Gabriel',
]

const LAST_NAMES = [
  'Silva', 'Souza', 'Oliveira', 'Santos', 'Pereira', 'Costa', 'Rodrigues',
  'Almeida', 'Nascimento', 'Lima', 'Araújo', 'Fernandes', 'Carvalho',
  'Gomes', 'Martins', 'Rocha', 'Ribeiro', 'Alves', 'Monteiro', 'Barbosa',
  'Cardoso', 'Teixeira', 'Moreira', 'Correia', 'Machado',
]

/** Matches the `Select` values `patient-form.tsx` writes for this field. */
const REFERRAL_SOURCES: Array<{ key: string; ratio: number }> = [
  { key: 'instagram', ratio: 0.45 },
  { key: 'indicacao', ratio: 0.35 },
  { key: 'google', ratio: 0.2 },
]

const GENDERS: Array<{ key: SeededPatient['gender']; ratio: number }> = [
  { key: 'feminino', ratio: 0.7 },
  { key: 'masculino', ratio: 0.3 },
]

/**
 * Builds `count` deterministic patient identities anchored to `today`
 * (never to `new Date()` internally, so a seed run is reproducible given
 * the same inputs). Ages fall between 24 and 45: each patient's birth
 * month/day is chosen to already have occurred this year relative to
 * `today`, so `today's year - birth year` is the exact age without any
 * calendar-arithmetic ambiguity.
 */
export function buildPatients(count: number, today: Date): SeededPatient[] {
  const genders = proportionalAssignment(count, GENDERS)
  const referralSources = proportionalAssignment(count, REFERRAL_SOURCES)

  const todayYmd = toBrYmd(today)
  const [todayYearStr, todayMonthStr, todayDayStr] = todayYmd.split('-')
  const todayYear = Number(todayYearStr)
  const todayMonth = Number(todayMonthStr)
  const todayDay = Number(todayDayStr)

  const takenEmails = new Set<string>()
  let femaleIdx = 0
  let maleIdx = 0
  const patients: SeededPatient[] = []

  for (let i = 0; i < count; i++) {
    const gender = genders[i]
    const first =
      gender === 'feminino'
        ? FEMALE_FIRST_NAMES[femaleIdx++ % FEMALE_FIRST_NAMES.length]
        : MALE_FIRST_NAMES[maleIdx++ % MALE_FIRST_NAMES.length]
    const last = LAST_NAMES[i % LAST_NAMES.length]
    const fullName = `${first} ${last}`

    const ageRng = mulberry32(1_000 + i * 13)
    const age = 24 + Math.floor(ageRng() * 22) // inclusive 24..45

    const birthRng = mulberry32(2_000 + i * 17)
    const birthYear = todayYear - age
    // Cap month/day at today's so the birthday has already passed this
    // year -- keeps the age computation exact, with no off-by-one.
    const month = 1 + Math.floor(birthRng() * todayMonth)
    const maxDay = month === todayMonth ? todayDay : 28
    const day = 1 + Math.floor(birthRng() * maxDay)
    const birthDate = `${birthYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

    patients.push({
      id: crypto.randomUUID(),
      fullName,
      cpf: generateCpf(i + 1),
      birthDate,
      gender,
      email: generateEmail(fullName, takenEmails),
      phone: generatePhone(i + 1),
      referralSource: referralSources[i],
    })
  }

  return patients
}

import { db } from '@/db/client'
import { patients } from '@/db/schema'
import { eq, and, isNull, ilike, or, sql, asc } from 'drizzle-orm'
import type { PaginatedResult } from '@/types'
import type { CreatePatientInput, UpdatePatientInput } from '@/validations/patient'
import { normalizeBrPhone } from '@/lib/phone'

export type Patient = typeof patients.$inferSelect

export async function listPatients(
  tenantId: string,
  { search = '', page = 1, limit = 20, responsibleUserId }: { search?: string; page?: number; limit?: number; responsibleUserId?: string }
): Promise<PaginatedResult<Patient>> {
  const offset = (page - 1) * limit

  const baseConditions = [
    eq(patients.tenantId, tenantId),
    isNull(patients.deletedAt),
  ]

  if (responsibleUserId) {
    baseConditions.push(eq(patients.responsibleUserId, responsibleUserId))
  }

  const escaped = search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
  const digitsOnly = search.replace(/\D/g, '')
  const phoneCondition = digitsOnly.length >= 2
    ? sql`regexp_replace(${patients.phone}, '[^0-9]', '', 'g') like ${'%' + digitsOnly + '%'}`
    : ilike(patients.phone, `%${escaped}%`)
  const searchCondition = escaped
    ? or(
        ilike(patients.fullName, `%${escaped}%`),
        phoneCondition,
        ilike(patients.cpf, `%${escaped}%`)
      )
    : undefined

  const whereConditions = searchCondition
    ? and(...baseConditions, searchCondition)
    : and(...baseConditions)

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(patients)
      .where(whereConditions)
      .orderBy(asc(patients.fullName))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(patients)
      .where(whereConditions),
  ])

  const total = countResult[0]?.count ?? 0

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

export async function getPatient(tenantId: string, patientId: string): Promise<Patient | null> {
  const [patient] = await db
    .select()
    .from(patients)
    .where(
      and(
        eq(patients.id, patientId),
        eq(patients.tenantId, tenantId),
        isNull(patients.deletedAt)
      )
    )
    .limit(1)

  return patient ?? null
}

/**
 * Match on the tail of the number, country code and 9th digit agnostic.
 *
 * `patients.phone` holds whatever the clinic typed and is never normalized, so
 * the same person can be stored as `(47) 98844-3635`, `+55 47 98844-3635` or
 * `(47) 8844-3635`. Callers, meanwhile, now pass the canonical
 * `5547988443635`. Comparing a canonicalized input against a raw column finds
 * only one of those shapes, and a miss is not harmless: the webhook then calls
 * `upsertConversation` with `patientId: null`, which clears an existing link.
 */
export function phoneTailVariants(phone: string): string[] {
  const canonical = normalizeBrPhone(phone)
  if (!/^55\d{10,11}$/.test(canonical)) return []

  const local = canonical.slice(2)
  const ddd = local.slice(0, 2)
  const subscriber = local.slice(2)

  // A mobile is stored either with or without the 9th digit. A landline has
  // only the 8-digit form, and must not gain a variant that invents a 9.
  return subscriber.length === 9 && subscriber.startsWith('9')
    ? [ddd + subscriber, ddd + subscriber.slice(1)]
    : [ddd + subscriber]
}

export async function getPatientByPhone(tenantId: string, phone: string): Promise<Patient | null> {
  const variants = phoneTailVariants(phone)
  const storedDigits = sql`regexp_replace(${patients.phone}, '\\D', '', 'g')`

  // Nothing placeable in the input (a foreign number, a half-typed entry).
  // Fall back to comparing the digits exactly rather than matching a tail,
  // which on a short string would match far too much.
  const phoneMatches =
    variants.length > 0
      ? or(...variants.map((v) => sql`right(${storedDigits}, ${v.length}) = ${v}`))
      : sql`${storedDigits} = ${phone.replace(/\D/g, '')}`

  const [patient] = await db
    .select()
    .from(patients)
    .where(and(eq(patients.tenantId, tenantId), isNull(patients.deletedAt), phoneMatches))
    .limit(1)

  return patient ?? null
}

export async function createPatient(
  tenantId: string,
  data: CreatePatientInput,
  responsibleUserId?: string
): Promise<Patient> {
  const [patient] = await db
    .insert(patients)
    .values({
      tenantId,
      responsibleUserId: responsibleUserId ?? null,
      fullName: data.fullName,
      phone: data.phone,
      cpf: data.cpf || null,
      birthDate: data.birthDate || null,
      gender: data.gender || null,
      email: data.email || null,
      phoneSecondary: data.phoneSecondary || null,
      address: data.address || null,
      occupation: data.occupation || null,
      referralSource: data.referralSource || null,
      notes: data.notes || null,
    })
    .returning()

  return patient
}

export async function updatePatient(
  tenantId: string,
  patientId: string,
  data: Omit<UpdatePatientInput, 'id'>
): Promise<Patient | null> {
  const updateData: Record<string, unknown> = { updatedAt: new Date() }

  if (data.fullName !== undefined) updateData.fullName = data.fullName
  if (data.phone !== undefined) updateData.phone = data.phone
  if (data.cpf !== undefined) updateData.cpf = data.cpf || null
  if (data.birthDate !== undefined) updateData.birthDate = data.birthDate || null
  if (data.gender !== undefined) updateData.gender = data.gender || null
  if (data.email !== undefined) updateData.email = data.email || null
  if (data.phoneSecondary !== undefined) updateData.phoneSecondary = data.phoneSecondary || null
  if (data.address !== undefined) updateData.address = data.address || null
  if (data.occupation !== undefined) updateData.occupation = data.occupation || null
  if (data.referralSource !== undefined) updateData.referralSource = data.referralSource || null
  if (data.notes !== undefined) updateData.notes = data.notes || null

  const [patient] = await db
    .update(patients)
    .set(updateData)
    .where(
      and(
        eq(patients.id, patientId),
        eq(patients.tenantId, tenantId),
        isNull(patients.deletedAt)
      )
    )
    .returning()

  return patient ?? null
}

export async function deletePatient(tenantId: string, patientId: string): Promise<Patient | null> {
  const [patient] = await db
    .update(patients)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(patients.id, patientId),
        eq(patients.tenantId, tenantId),
        isNull(patients.deletedAt)
      )
    )
    .returning()

  return patient ?? null
}

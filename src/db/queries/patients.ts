import { db } from '@/db/client'
import { patients } from '@/db/schema'
import { eq, and, isNull, ilike, or, sql, asc } from 'drizzle-orm'
import type { PaginatedResult } from '@/types'
import type { CreatePatientInput, UpdatePatientInput } from '@/validations/patient'

export type Patient = typeof patients.$inferSelect

export async function listPatients(
  tenantId: string,
  { search = '', page = 1, limit = 20 }: { search?: string; page?: number; limit?: number }
): Promise<PaginatedResult<Patient>> {
  const offset = (page - 1) * limit

  const baseConditions = [
    eq(patients.tenantId, tenantId),
    isNull(patients.deletedAt),
  ]

  const searchCondition = search.trim()
    ? or(
        ilike(patients.fullName, `%${search.trim()}%`),
        ilike(patients.phone, `%${search.trim()}%`),
        ilike(patients.cpf, `%${search.trim()}%`)
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

export async function createPatient(tenantId: string, data: CreatePatientInput): Promise<Patient> {
  const [patient] = await db
    .insert(patients)
    .values({
      tenantId,
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

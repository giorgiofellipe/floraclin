import { db } from '@/db/client'
import { anamneses } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import type { AnamnesisFormData } from '@/validations/anamnesis'

export async function getAnamnesis(tenantId: string, patientId: string) {
  const result = await db
    .select()
    .from(anamneses)
    .where(
      and(
        eq(anamneses.tenantId, tenantId),
        eq(anamneses.patientId, patientId)
      )
    )
    .limit(1)

  return result[0] ?? null
}

export class StaleDataError extends Error {
  constructor() {
    super('Os dados foram alterados por outro usuário. Recarregue a página e tente novamente.')
    this.name = 'StaleDataError'
  }
}

export async function upsertAnamnesis(
  tenantId: string,
  patientId: string,
  userId: string,
  data: AnamnesisFormData,
  expectedUpdatedAt?: Date
) {
  const existing = await getAnamnesis(tenantId, patientId)

  if (existing) {
    // Optimistic locking: reject if the row was modified since last read
    if (expectedUpdatedAt) {
      const existingTime = new Date(existing.updatedAt).getTime()
      const expectedTime = new Date(expectedUpdatedAt).getTime()
      if (existingTime !== expectedTime) {
        throw new StaleDataError()
      }
    }

    const [updated] = await db
      .update(anamneses)
      .set({
        mainComplaint: data.mainComplaint,
        patientGoals: data.patientGoals,
        medicalHistory: data.medicalHistory,
        medications: data.medications,
        allergies: data.allergies,
        previousSurgeries: data.previousSurgeries,
        chronicConditions: data.chronicConditions,
        isPregnant: data.isPregnant,
        isBreastfeeding: data.isBreastfeeding,
        lifestyle: data.lifestyle,
        skinType: data.skinType,
        skinConditions: data.skinConditions,
        skincareRoutine: data.skincareRoutine,
        previousAestheticTreatments: data.previousAestheticTreatments,
        contraindications: data.contraindications,
        facialEvaluationNotes: data.facialEvaluationNotes,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(anamneses.tenantId, tenantId),
          eq(anamneses.patientId, patientId)
        )
      )
      .returning()

    return updated
  }

  // Insert new
  const [inserted] = await db
    .insert(anamneses)
    .values({
      tenantId,
      patientId,
      mainComplaint: data.mainComplaint,
      patientGoals: data.patientGoals,
      medicalHistory: data.medicalHistory,
      medications: data.medications,
      allergies: data.allergies,
      previousSurgeries: data.previousSurgeries,
      chronicConditions: data.chronicConditions,
      isPregnant: data.isPregnant,
      isBreastfeeding: data.isBreastfeeding,
      lifestyle: data.lifestyle,
      skinType: data.skinType,
      skinConditions: data.skinConditions,
      skincareRoutine: data.skincareRoutine,
      previousAestheticTreatments: data.previousAestheticTreatments,
      contraindications: data.contraindications,
      facialEvaluationNotes: data.facialEvaluationNotes,
      updatedBy: userId,
    })
    .returning()

  return inserted
}

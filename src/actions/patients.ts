'use server'

import { requireRole } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import {
  listPatients as listPatientsQuery,
  getPatient as getPatientQuery,
  createPatient as createPatientQuery,
  updatePatient as updatePatientQuery,
  deletePatient as deletePatientQuery,
} from '@/db/queries/patients'
import { createPatientSchema, updatePatientSchema, patientSearchSchema } from '@/validations/patient'
import type { CreatePatientInput, UpdatePatientInput } from '@/validations/patient'

export type PatientActionState = {
  success?: boolean
  error?: string
  fieldErrors?: Record<string, string[]>
} | null

export async function createPatientAction(data: CreatePatientInput): Promise<PatientActionState> {
  try {
    const auth = await requireRole('owner', 'practitioner', 'receptionist')

    const parsed = createPatientSchema.safeParse(data)
    if (!parsed.success) {
      return { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
    }

    const patient = await createPatientQuery(auth.tenantId, parsed.data)

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'create',
      entityType: 'patient',
      entityId: patient.id,
      changes: { patient: { old: null, new: parsed.data } },
    })

    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para criar pacientes' }
    }
    return { error: 'Erro ao criar paciente' }
  }
}

export async function updatePatientAction(data: UpdatePatientInput): Promise<PatientActionState> {
  try {
    const auth = await requireRole('owner', 'practitioner', 'receptionist')

    const parsed = updatePatientSchema.safeParse(data)
    if (!parsed.success) {
      return { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
    }

    const { id, ...updateData } = parsed.data
    const existing = await getPatientQuery(auth.tenantId, id)
    if (!existing) {
      return { error: 'Paciente não encontrado' }
    }

    const patient = await updatePatientQuery(auth.tenantId, id, updateData)
    if (!patient) {
      return { error: 'Erro ao atualizar paciente' }
    }

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'update',
      entityType: 'patient',
      entityId: id,
      changes: { patient: { old: existing, new: updateData } },
    })

    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para editar pacientes' }
    }
    return { error: 'Erro ao atualizar paciente' }
  }
}

export async function deletePatientAction(patientId: string): Promise<PatientActionState> {
  try {
    const auth = await requireRole('owner', 'practitioner', 'receptionist')

    const patient = await deletePatientQuery(auth.tenantId, patientId)
    if (!patient) {
      return { error: 'Paciente não encontrado' }
    }

    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: 'delete',
      entityType: 'patient',
      entityId: patientId,
    })

    return { success: true }
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden: insufficient permissions') {
      return { error: 'Sem permissão para excluir pacientes' }
    }
    return { error: 'Erro ao excluir paciente' }
  }
}

export async function listPatientsAction(search = '', page = 1, limit = 20) {
  try {
    const auth = await requireRole('owner', 'practitioner', 'receptionist')

    const parsed = patientSearchSchema.safeParse({ search, page, limit })
    if (!parsed.success) {
      return { data: [], total: 0, page: 1, limit: 20, totalPages: 0 }
    }

    return await listPatientsQuery(auth.tenantId, parsed.data)
  } catch {
    return { data: [], total: 0, page: 1, limit: 20, totalPages: 0 }
  }
}

export async function getPatientAction(patientId: string) {
  try {
    const auth = await requireRole('owner', 'practitioner', 'receptionist')
    return await getPatientQuery(auth.tenantId, patientId)
  } catch {
    return null
  }
}

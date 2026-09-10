import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getAuthContext } from '@/lib/auth'
import { requireRole } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { professionalProfileSchema } from '@/validations/professional'
import { handleApiError } from '@/lib/api-error'

function hashSignature(sig: string | null | undefined): string | null {
  if (!sig) return null
  return crypto.createHash('sha256').update(sig).digest('hex')
}

const updateProfileSchema = z
  .object({
    fullName: z.string().min(1, 'Nome é obrigatório').optional(),
    phone: z.string().optional(),
  })
  .merge(professionalProfileSchema)

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const [user] = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        phone: users.phone,
        signatureData: users.signatureData,
        signatureUpdatedAt: users.signatureUpdatedAt,
        professionalTitle: users.professionalTitle,
        registryType: users.registryType,
        registryNumber: users.registryNumber,
        registryState: users.registryState,
      })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1)

    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: user })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function PUT(request: Request) {
  try {
    // Your own profile, not tenant data, and unrestricted by role before this
    // change. Kept out of the billing gate for the same reason as the password
    // route next door.
    const ctx = await requireRole('owner', 'practitioner', 'receptionist', 'financial')
    const body = await request.json()
    const parsed = updateProfileSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    // Snapshot the previous values for audit diff. Signature is hashed — we
    // never write raw base64 into audit_logs (a PNG can be 100+ KB and is PII).
    const [before] = await db
      .select({
        fullName: users.fullName,
        phone: users.phone,
        signatureData: users.signatureData,
        signatureUpdatedAt: users.signatureUpdatedAt,
        professionalTitle: users.professionalTitle,
        registryType: users.registryType,
        registryNumber: users.registryNumber,
        registryState: users.registryState,
      })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1)

    const now = new Date()
    const updateData: Record<string, unknown> = { updatedAt: now }
    if (parsed.data.fullName !== undefined) updateData.fullName = parsed.data.fullName
    if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone || null
    if (parsed.data.signatureData !== undefined) {
      updateData.signatureData = parsed.data.signatureData
      updateData.signatureUpdatedAt = now
    }
    if (parsed.data.professionalTitle !== undefined)
      updateData.professionalTitle = parsed.data.professionalTitle
    if (parsed.data.registryType !== undefined) updateData.registryType = parsed.data.registryType
    if (parsed.data.registryNumber !== undefined)
      updateData.registryNumber = parsed.data.registryNumber
    if (parsed.data.registryState !== undefined)
      updateData.registryState = parsed.data.registryState

    await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, ctx.userId))

    // Build a focused diff: only fields that actually changed.
    const changes: Record<string, { old: unknown; new: unknown }> = {}
    const trackField = (
      key: 'fullName' | 'phone' | 'professionalTitle' | 'registryType' | 'registryNumber' | 'registryState',
    ) => {
      const incoming = parsed.data[key]
      if (incoming === undefined) return
      const oldVal = before?.[key] ?? null
      const newVal = incoming ?? null
      if (oldVal !== newVal) {
        changes[key] = { old: oldVal, new: newVal }
      }
    }
    trackField('fullName')
    trackField('phone')
    trackField('professionalTitle')
    trackField('registryType')
    trackField('registryNumber')
    trackField('registryState')

    if (parsed.data.signatureData !== undefined) {
      const oldHash = hashSignature(before?.signatureData ?? null)
      const newHash = hashSignature(parsed.data.signatureData)
      if (oldHash !== newHash) {
        changes.signature = {
          old: { sha256: oldHash, updatedAt: before?.signatureUpdatedAt ?? null },
          new: { sha256: newHash, updatedAt: now },
        }
      }
    }

    // We hold a tenantId in the auth context, but a user can belong to several
    // tenants; the profile lives on the user row itself, not a tenant. Log
    // under the currently-active tenant so admins see profile changes alongside
    // other tenant audit events. Skip the insert if nothing actually changed.
    if (Object.keys(changes).length > 0) {
      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'update',
        entityType: 'user_profile',
        entityId: ctx.userId,
        changes,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}

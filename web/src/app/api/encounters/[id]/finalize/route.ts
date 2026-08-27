/**
 * POST /api/encounters/[id]/finalize
 *
 * Patch P1 of the package + encounter redesign: the wizard owns multiple
 * `draft` `procedure_records` (one per cart line) and submits them as a unit.
 * Finalize-in-place semantics — we update the existing draft rows to
 * `approved` instead of cancelling them and re-creating, which would orphan
 * any side data (face diagrams, products, plannedSnapshot) the wizard has
 * already persisted.
 *
 * The `[id]` segment is a UUID. It is the canonical encounter id: the
 * wizard mints it client-side and uses it in the redirect to step 5
 * (`/encounters/{id}`); we pass it through to C1 so the persisted rows
 * (procedure_records.encounterId, audit log entityId) carry the same UUID
 * the URL uses. Without this, the picker fetch for `/api/encounters/{id}`
 * after finalization would 404.
 *
 * Security: `practitionerId` is NEVER taken from the request body. We use
 * `ctx.userId` (the authenticated caller) — a tenant owner that finalizes IS
 * the practitioner of record. Trusting the client here would let a tenant A
 * owner attribute sales (`patient_packages.soldBy`) to any user UUID
 * (including users in tenant B), corrupting reports.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireWrite } from '@/lib/write-access'
import { finalizeEncounter } from '@/lib/encounter-finalize'
import { encounterCartSchema } from '@/validations/encounter-cart'
import { getDefaultPackageValidityMonths } from '@/lib/tenant-settings'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { handleApiError } from '@/lib/api-error'

const requestSchema = z.object({
  cart: encounterCartSchema,
  draftRecordIds: z.array(z.string().uuid()).min(1),
  patientId: z.string().uuid(),
  financialPlan: z.object({
    totalAmount: z.string(),
    installmentCount: z.number().int().min(1),
    paymentMethod: z.string(),
    notes: z.string().optional(),
  }),
  consents: z.array(
    z.object({
      consentTemplateId: z.string().uuid(),
      signatureData: z.string(),
      contentSnapshot: z.string(),
      contentHash: z.string(),
      acceptanceMethod: z.string(),
    }),
  ),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { ctx, blocked } = await requireWrite('owner', 'practitioner')
    if (blocked) return blocked

    const { id: encounterIdFromUrl } = await params

    // Validate the URL param is a UUID — this becomes the canonical
    // encounterId we pass to C1 (see file header).
    const urlIdParsed = z.string().uuid().safeParse(encounterIdFromUrl)
    if (!urlIdParsed.success) {
      return NextResponse.json(
        { success: false, error: 'encounterId inválido na URL' },
        { status: 400 },
      )
    }
    const encounterId = urlIdParsed.data

    const body = requestSchema.parse(await request.json())

    const [tenant] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    const defaultValidity = getDefaultPackageValidityMonths(tenant?.settings)

    const result = await finalizeEncounter({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      encounterId,
      patientId: body.patientId,
      practitionerId: ctx.userId,
      cart: body.cart,
      draftRecordIds: body.draftRecordIds,
      financialPlan: body.financialPlan,
      consents: body.consents,
      tenantDefaultValidityMonths: defaultValidity,
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Payload inválido', issues: error.issues },
        { status: 400 },
      )
    }

    const errorMsg = error instanceof Error ? error.message : ''
    if (errorMsg.includes('já está em estado')) {
      return NextResponse.json(
        { success: false, error: errorMsg },
        { status: 409 },
      )
    }
    return handleApiError(error, request, { body: { success: false, error: 'Erro ao finalizar atendimento' } })
  }
}

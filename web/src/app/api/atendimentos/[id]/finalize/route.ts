/**
 * POST /api/atendimentos/[id]/finalize
 *
 * Patch P1 of the package + atendimento redesign: the wizard owns multiple
 * `draft` `procedure_records` (one per cart line) and submits them as a unit.
 * Finalize-in-place semantics — we update the existing draft rows to
 * `approved` instead of cancelling them and re-creating, which would orphan
 * any side data (face diagrams, products, plannedSnapshot) the wizard has
 * already persisted.
 *
 * The `[id]` segment is a UUID. It is the canonical atendimento id: the
 * wizard mints it client-side and uses it in the redirect to step 5
 * (`/atendimentos/{id}`); we pass it through to C1 so the persisted rows
 * (procedure_records.atendimentoId, audit log entityId) carry the same UUID
 * the URL uses. Without this, the picker fetch for `/api/atendimentos/{id}`
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
import { requireRole } from '@/lib/auth'
import { finalizeAtendimento } from '@/lib/atendimento-finalize'
import { atendimentoCartSchema } from '@/validations/atendimento-cart'
import { getDefaultPackageValidityMonths } from '@/lib/tenant-settings'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'

const requestSchema = z.object({
  cart: atendimentoCartSchema,
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
    const ctx = await requireRole('owner', 'practitioner')
    const { id: atendimentoIdFromUrl } = await params

    // Validate the URL param is a UUID — this becomes the canonical
    // atendimentoId we pass to C1 (see file header).
    const urlIdParsed = z.string().uuid().safeParse(atendimentoIdFromUrl)
    if (!urlIdParsed.success) {
      return NextResponse.json(
        { success: false, error: 'atendimentoId inválido na URL' },
        { status: 400 },
      )
    }
    const atendimentoId = urlIdParsed.data

    const body = requestSchema.parse(await request.json())

    const [tenant] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    const defaultValidity = getDefaultPackageValidityMonths(tenant?.settings)

    const result = await finalizeAtendimento({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      atendimentoId,
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
    if (error instanceof Error) {
      const msg = error.message
      if (msg.includes('Forbidden')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (msg.includes('redirect') || msg.includes('NEXT_REDIRECT')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }
    console.error('Finalize atendimento error:', error)
    return NextResponse.json(
      { success: false, error: 'Erro ao finalizar atendimento' },
      { status: 500 },
    )
  }
}

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { getTenant, updateTenant, updateTenantSettings, isPhoneNumberIdClaimedByAnotherTenant, mergeSettings } from '@/db/queries/tenants'
import { signLogoPath } from '@/lib/logo'
import { updateTenantSchema, bookingSettingsSchema, bookingSlugSchema } from '@/validations/tenant'
import { whatsappSettingsSchema } from '@/validations/whatsapp'
import { handleApiError } from '@/lib/api-error'
import { checkPlanFeature } from '@/lib/plans'
import { verifyCredentials } from '@/lib/whatsapp'
import { changeBookingSlug } from '@/db/queries/booking-slugs'
import { BOOKING_SLUG_MESSAGES } from '@/lib/booking-slug'

type Settings = Record<string, unknown> | undefined

// The webhook routes an own number to whichever tenant holds its id, so a new
// claim must show Meta lets this token reach that number.
async function ownNumberClaimError(tenantId: string, settings: Settings, current: Settings) {
  const id = settings?.whatsapp_phone_number_id
  if (settings?.whatsapp_mode !== 'own' || typeof id !== 'string' || !id) return null

  const token = (settings.whatsapp_access_token || current?.whatsapp_access_token) as string | undefined
  const isNewClaim =
    current?.whatsapp_mode !== 'own' || current?.whatsapp_phone_number_id !== id || current?.whatsapp_access_token !== token
  if (isNewClaim && (!token || !(await verifyCredentials(id, token)).valid)) {
    return NextResponse.json(
      { error: 'Não foi possível confirmar este ID do número de telefone com o token de acesso informado.' },
      { status: 400 },
    )
  }

  if (await isPhoneNumberIdClaimedByAnotherTenant(tenantId, id)) {
    return NextResponse.json(
      { error: 'Este número de WhatsApp já está conectado a outra clínica.' },
      { status: 409 },
    )
  }
  return null
}

export async function GET(request: Request) {
  try {
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    if (!tenant) return NextResponse.json(null)

    // `tenants.logo_url` holds a storage path; the browser needs a URL it can
    // actually load. This is the boundary the settings page, the consent
    // history preview and the clinical-document preview all read through.
    const logoUrl = await signLogoPath(tenant.logoUrl)

    if (tenant.settings) {
      const settings = { ...(tenant.settings as Record<string, unknown>) }
      delete settings.whatsapp_access_token
      return NextResponse.json({ ...tenant, logoUrl, settings })
    }
    return NextResponse.json({ ...tenant, logoUrl })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function PUT(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const body = await request.json()

    // WhatsApp settings update
    if (body._action === 'whatsapp_settings') {
      const parsed = whatsappSettingsSchema.safeParse(body.settings)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
          { status: 400 },
        )
      }

      // Only the keys sent are written, so a role change cannot overwrite a
      // connection saved from another tab (updateTenantSettings merges keys).
      const settingsUpdate: Settings = Object.fromEntries(
        Object.entries(parsed.data).filter(([key, value]) => value !== undefined && (key !== 'whatsapp_access_token' || value)),
      )

      const credentialKeys = ['whatsapp_phone_number_id', 'whatsapp_business_account_id', 'whatsapp_access_token']
      const changesCredentials = credentialKeys.some((key) => key in settingsUpdate!)
      if (changesCredentials || 'whatsapp_mode' in settingsUpdate!) {
        const current = await getTenant(ctx.tenantId)
        const currentSettings = current?.settings as Settings
        const next = { ...currentSettings, ...settingsUpdate }

        // The plan is checked only when the clinic moves onto its own number or
        // changes its credentials, never on the way back to FloraClin or on a
        // role change: a downgraded own-number clinic must still be able to leave.
        // getTemplateForTenant branches on whatsapp_mode, so this gate is what
        // keeps a free tenant off its own Meta credentials.
        const entersOwnNumber = next.whatsapp_mode === 'own' && (currentSettings?.whatsapp_mode !== 'own' || changesCredentials)
        if (entersOwnNumber && !(await checkPlanFeature(ctx.tenantId, 'own_whatsapp_number'))) {
          return NextResponse.json(
            { error: 'Seu plano não inclui número próprio de WhatsApp. Faça upgrade para ativar.' },
            { status: 402 },
          )
        }

        const claimError = await ownNumberClaimError(ctx.tenantId, next, currentSettings)
        if (claimError) return claimError
      }

      const tenant = await updateTenantSettings(ctx.tenantId, settingsUpdate)
      if (!tenant) {
        return NextResponse.json({ error: 'Erro ao atualizar configurações do WhatsApp' }, { status: 500 })
      }

      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'update',
        entityType: 'tenant',
        entityId: ctx.tenantId,
        changes: { whatsappSettings: { old: null, new: 'updated' } },
      })

      return NextResponse.json({ success: true })
    }

    // Clinic settings update (e.g., defaultPackageValidityMonths)
    if (body._action === 'clinic_settings') {
      const parsed = z.object({
        defaultPackageValidityMonths: z.number().int().min(1).max(120).nullable(),
      }).safeParse(body.settings)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
          { status: 400 },
        )
      }

      await db.update(tenants)
        .set({
          settings: mergeSettings(parsed.data),
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, ctx.tenantId))

      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'update',
        entityType: 'tenant',
        entityId: ctx.tenantId,
        changes: { clinicSettings: { old: null, new: 'updated' } },
      })

      return NextResponse.json({ success: true })
    }

    // Check if this is a booking settings update
    if (body._action === 'booking_settings') {
      const parsed = bookingSettingsSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
      }

      const tenant = await updateTenantSettings(ctx.tenantId, {
        online_booking_enabled: parsed.data.publicBookingEnabled,
      })

      if (!tenant) {
        return NextResponse.json({ error: 'Erro ao atualizar configurações de agendamento' }, { status: 500 })
      }

      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'update',
        entityType: 'tenant',
        entityId: ctx.tenantId,
        changes: { bookingSettings: { old: null, new: parsed.data } },
      })

      return NextResponse.json({ success: true })
    }

    // The public booking link. Chosen in onboarding before; now set here, any
    // time. The old link redirects to the new one, and stays reserved for this
    // clinic, for SLUG_RESERVATION_DAYS (changeBookingSlug).
    if (body._action === 'booking_slug') {
      const current = await getTenant(ctx.tenantId)
      if (!current) return NextResponse.json({ error: 'Clínica não encontrada' }, { status: 404 })
      // Unchanged is accepted before the rules: a link from before they
      // existed (one or two characters) must not stop the form from saving.
      if (typeof body.slug === 'string' && body.slug.trim().toLowerCase() === current.slug) {
        return NextResponse.json({ success: true, slug: current.slug })
      }
      const parsed = bookingSlugSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? 'Link inválido', fieldErrors: parsed.error.flatten().fieldErrors },
          { status: 400 },
        )
      }

      const result = await changeBookingSlug({ tenantId: ctx.tenantId, userId: ctx.userId, slug: parsed.data.slug })
      switch (result.outcome) {
        case 'not_found':
          return NextResponse.json({ error: 'Clínica não encontrada' }, { status: 404 })
        case 'taken':
          return NextResponse.json({ error: BOOKING_SLUG_MESSAGES.taken }, { status: 409 })
        case 'rate_limited':
          return NextResponse.json({ error: BOOKING_SLUG_MESSAGES.rateLimited }, { status: 429 })
        default:
          return NextResponse.json({ success: true, slug: result.slug })
      }
    }

    // Regular tenant update
    const parsed = updateTenantSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    // The same entitlement check as the whatsapp_settings branch above, and
    // it has to be here too. `tenantSettingsSchema` is `.passthrough()` and
    // `updateTenant` writes any key it is given, so this branch could set
    // whatsapp_mode without ever touching the guarded branch. Gating one
    // entry point and not the other is the same as not gating it.
    const incomingMode = (parsed.data.settings as Record<string, unknown> | undefined)
      ?.whatsapp_mode
    if (incomingMode === 'own') {
      const allowed = await checkPlanFeature(ctx.tenantId, 'own_whatsapp_number')
      if (!allowed) {
        return NextResponse.json(
          { error: 'Seu plano não inclui número próprio de WhatsApp. Faça upgrade para ativar.' },
          { status: 402 },
        )
      }
    }

    const existing = await getTenant(ctx.tenantId)
    const claimError = await ownNumberClaimError(
      ctx.tenantId,
      parsed.data.settings as Settings,
      existing?.settings as Settings,
    )
    if (claimError) return claimError

    const tenant = await updateTenant(ctx.tenantId, parsed.data)
    if (!tenant) {
      return NextResponse.json({ error: 'Erro ao atualizar configurações' }, { status: 500 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'tenant',
      entityId: ctx.tenantId,
      changes: { tenant: { old: existing, new: parsed.data } },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}

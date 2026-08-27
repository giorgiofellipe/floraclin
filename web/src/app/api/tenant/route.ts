import { NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { getTenant, updateTenant, updateTenantSettings } from '@/db/queries/tenants'
import { signLogoPath } from '@/lib/logo'
import { updateTenantSchema, bookingSettingsSchema } from '@/validations/tenant'
import { whatsappSettingsSchema } from '@/validations/whatsapp'
import { handleApiError } from '@/lib/api-error'

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

      const settingsUpdate: Record<string, unknown> = {
        whatsapp_mode: parsed.data.whatsapp_mode ?? 'floraclin',
        whatsapp_enabled: parsed.data.whatsapp_enabled,
        whatsapp_phone_number_id: parsed.data.whatsapp_phone_number_id ?? null,
        whatsapp_business_account_id: parsed.data.whatsapp_business_account_id ?? null,
        whatsapp_allowed_roles: parsed.data.whatsapp_allowed_roles,
      }
      if (parsed.data.whatsapp_access_token) {
        settingsUpdate.whatsapp_access_token = parsed.data.whatsapp_access_token
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
          settings: sql`COALESCE(${tenants.settings}, '{}'::jsonb) || ${JSON.stringify(parsed.data)}::jsonb`,
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

    // Regular tenant update
    const parsed = updateTenantSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const existing = await getTenant(ctx.tenantId)
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

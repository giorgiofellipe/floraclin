import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { getTenant, updateTenant, updateTenantSettings } from '@/db/queries/tenants'
import { updateTenantSchema, bookingSettingsSchema } from '@/validations/tenant'
import { whatsappSettingsSchema } from '@/validations/whatsapp'

export async function GET() {
  try {
    const ctx = await getAuthContext()
    const tenant = await getTenant(ctx.tenantId)
    if (tenant?.settings) {
      const settings = { ...(tenant.settings as Record<string, unknown>) }
      delete settings.whatsapp_access_token
      return NextResponse.json({ ...tenant, settings })
    }
    return NextResponse.json(tenant)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

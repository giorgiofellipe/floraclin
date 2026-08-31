import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { createAuditLog } from '@/lib/audit'
import { inviteUser } from '@/db/queries/users'
import { inviteUserSchema } from '@/validations/user'
import { handleApiError } from '@/lib/api-error'
import { checkPlanLimit } from '@/lib/plans'

export async function POST(request: Request) {
  try {
    const { ctx, blocked } = await requireWrite('owner')
    if (blocked) return blocked

    const body = await request.json()
    const parsed = inviteUserSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    // The seat limit is enforced here and only here. Checked after
    // validation so a malformed request does not read the plan, and before
    // the invite so the seat is never consumed. Existing members over the
    // limit are left alone: this refuses new seats, it does not evict anyone.
    const seats = await checkPlanLimit(ctx.tenantId, 'users')
    if (!seats.allowed) {
      return NextResponse.json(
        {
          error: `Seu plano permite ${seats.limit} usuários e você já tem ${seats.used}. Faça upgrade para convidar mais.`,
          limit: seats.limit,
          used: seats.used,
        },
        { status: 402 },
      )
    }

    const result = await inviteUser(ctx.tenantId, parsed.data)
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Erro ao convidar usuário' }, { status: 400 })
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create',
      entityType: 'tenant_user',
      changes: { invite: { old: null, new: { email: parsed.data.email, role: parsed.data.role } } },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}

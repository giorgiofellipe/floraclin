import { NextResponse } from 'next/server'
import { getValidToken, markTokenUsed } from '@/db/queries/anamnesis-tokens'
import { upsertAnamnesis } from '@/db/queries/anamnesis'
import { anamnesisSchema } from '@/validations/anamnesis'
import { handleApiError } from '@/lib/api-error'
import { isSubscriptionActive } from '@/lib/plans'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const row = await getValidToken(token)

    if (!row) {
      return NextResponse.json(
        { error: 'Link expirado ou já utilizado' },
        { status: 404 }
      )
    }

    // Gate on the tenant the token resolves to, not any session the caller
    // might hold. The patient may be filling this out while an unrelated
    // clinic's subscription is inactive; that must not block them.
    if (!(await isSubscriptionActive(row.tenantId))) {
      return NextResponse.json(
        { error: 'Esta clínica não está aceitando envios no momento.' },
        { status: 403 }
      )
    }

    return NextResponse.json({
      firstName: row.patientName.split(' ')[0],
      patientId: row.patientId,
    })
  } catch (error) {
    return handleApiError(error, request)
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const row = await getValidToken(token)

    if (!row) {
      return NextResponse.json(
        { error: 'Link expirado ou já utilizado' },
        { status: 404 }
      )
    }

    // Gate on the tenant the token resolves to, not any session the caller
    // might hold. The patient may be filling this out while an unrelated
    // clinic's subscription is inactive; that must not block them.
    if (!(await isSubscriptionActive(row.tenantId))) {
      return NextResponse.json(
        { error: 'Esta clínica não está aceitando envios no momento.' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const parsed = anamnesisSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            'Dados inválidos: ' +
            parsed.error.issues
              .map((i: { message: string }) => i.message)
              .join(', '),
        },
        { status: 400 }
      )
    }

    await upsertAnamnesis(
      row.tenantId,
      row.patientId,
      row.createdBy,
      parsed.data
    )

    await markTokenUsed(token)

    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, request)
  }
}

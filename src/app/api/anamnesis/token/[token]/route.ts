import { NextResponse } from 'next/server'
import { getValidToken, markTokenUsed } from '@/db/queries/anamnesis-tokens'
import { upsertAnamnesis } from '@/db/queries/anamnesis'
import { anamnesisSchema } from '@/validations/anamnesis'

export async function GET(
  _request: Request,
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

    return NextResponse.json({
      firstName: row.patientName.split(' ')[0],
      patientId: row.patientId,
    })
  } catch (error) {
    console.error('Token validation error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
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
    console.error('Token submission error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

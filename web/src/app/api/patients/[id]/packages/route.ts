import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { getPatientPackagesWithConsumption } from '@/db/queries/packages'
import { handleApiError } from '@/lib/api-error'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getAuthContext()
    const { id: patientId } = await params

    const packages = await getPatientPackagesWithConsumption(ctx.tenantId, patientId)
    return NextResponse.json(packages)
  } catch (error) {
    return handleApiError(error, request)
  }
}

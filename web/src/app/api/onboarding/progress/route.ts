import { NextResponse } from 'next/server'
import { requireWrite } from '@/lib/write-access'
import { saveOnboardingProgress } from '@/db/queries/tenants'
import { PLACEHOLDER_NAME_SETTING } from '@/lib/clinic-placeholder'
import { scheduleLifecycleWelcome } from '@/lib/lifecycle-sender'
import { onboardingProgressSchema } from '@/validations/onboarding'
import { handleApiError } from '@/lib/api-error'

export async function PATCH(request: Request) {
  try {
    const { ctx: auth, blocked } = await requireWrite('owner')
    if (blocked) return blocked
    const parsed = onboardingProgressSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados de onboarding inválidos', issues: parsed.error.flatten() },
        { status: 400 },
      )
    }
    const { clinic, draft } = parsed.data

    const settings: Record<string, unknown> = {}
    if (draft) settings.onboarding_draft = draft
    // Once the real name is saved, a reload must show it instead of an empty field.
    if (clinic.name) settings[PLACEHOLDER_NAME_SETTING] = false

    const { saved, noticeStamped } = await saveOnboardingProgress(auth.tenantId, clinic, settings)
    // The phone field shows the lifecycle notice, so the first saved phone is
    // when the owner has seen it and the held trial welcome can go out.
    if (noticeStamped) scheduleLifecycleWelcome({ tenantId: auth.tenantId })

    return NextResponse.json({ saved })
  } catch (error) {
    return handleApiError(error, request)
  }
}

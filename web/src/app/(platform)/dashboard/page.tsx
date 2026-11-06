import type { Metadata } from 'next'
import { DashboardPageClient } from './dashboard-page-client'
import { FIRST_PATIENT_HIGHLIGHT_PARAM, wantsFirstPatientHighlight } from '@/lib/first-patient-highlight'
import { EMAIL_CONFIRMED_PARAM, wantsEmailConfirmedToast } from '@/lib/email-confirmed-toast'
import { EmailConfirmedToast } from '@/components/layout/email-confirmed-toast'
import { getAuthContext } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Dashboard | FloraClin',
}

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams
  const auth = await getAuthContext()
  // A hand-made ?email_confirmed=1 never says so to an owner who has not confirmed.
  const showEmailConfirmed = wantsEmailConfirmedToast(params[EMAIL_CONFIRMED_PARAM]) && auth.emailVerified !== false
  return (
    <>
      <EmailConfirmedToast show={showEmailConfirmed} />
      <DashboardPageClient
        highlightFirstPatient={wantsFirstPatientHighlight(params[FIRST_PATIENT_HIGHLIGHT_PARAM])}
        canRequestImport={auth.role === 'owner' && !auth.isPlatformAdmin}
      />
    </>
  )
}

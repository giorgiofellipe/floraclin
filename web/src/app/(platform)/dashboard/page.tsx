import type { Metadata } from 'next'
import { DashboardPageClient } from './dashboard-page-client'
import { FIRST_PATIENT_HIGHLIGHT_PARAM, wantsFirstPatientHighlight } from '@/lib/first-patient-highlight'
import { EMAIL_CONFIRMED_PARAM, wantsEmailConfirmedToast } from '@/lib/email-confirmed-toast'
import { EmailConfirmedToast } from '@/components/layout/email-confirmed-toast'

export const metadata: Metadata = {
  title: 'Dashboard | FloraClin',
}

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams
  return (
    <>
      <EmailConfirmedToast show={wantsEmailConfirmedToast(params[EMAIL_CONFIRMED_PARAM])} />
      <DashboardPageClient highlightFirstPatient={wantsFirstPatientHighlight(params[FIRST_PATIENT_HIGHLIGHT_PARAM])} />
    </>
  )
}

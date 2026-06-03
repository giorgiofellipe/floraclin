import { redirect } from 'next/navigation'
import { getAuthContext } from '@/lib/auth'
import { getConsentAcceptanceWithContext } from '@/db/queries/consent'
import { PrintConsent } from '@/components/consent/print-consent'
import { PrintStylesheet } from '@/components/print/print-stylesheet'

export default async function PrintConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext()
  const { id } = await params
  const acceptance = await getConsentAcceptanceWithContext(ctx.tenantId, id)

  if (!acceptance) redirect('/dashboard')

  return (
    <>
      <PrintStylesheet />
      <PrintConsent acceptance={acceptance} />
    </>
  )
}

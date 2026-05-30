import { getValidSigningToken, getTemplatesForToken } from '@/db/queries/consent-signing-tokens'
import { RemoteConsentSigning } from '@/components/consent/remote-consent-signing'

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const tokenData = await getValidSigningToken(token)

  if (!tokenData) {
    return (
      <div className="text-center py-16">
        <h2 className="text-xl font-medium text-charcoal">Link expirado</h2>
        <p className="text-mid mt-2">Este link não é mais válido ou já foi utilizado.</p>
      </div>
    )
  }

  const templates = await getTemplatesForToken(
    tokenData.tenantId,
    tokenData.consentTemplateIds as string[],
  )

  const firstName = tokenData.patientName?.split(' ')[0] ?? 'Paciente'

  return (
    <RemoteConsentSigning
      token={token}
      firstName={firstName}
      templates={templates.map((t) => ({
        id: t.id,
        type: t.type,
        title: t.title,
        content: t.content,
        version: t.version,
      }))}
    />
  )
}

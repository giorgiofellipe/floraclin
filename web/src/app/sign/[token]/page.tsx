import { getValidSigningToken, getTemplatesForToken } from '@/db/queries/consent-signing-tokens'
import { RemoteConsentSigning } from '@/components/consent/remote-consent-signing'

const TOKEN_PATTERN = /^[0-9a-f]{64}$/

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  if (!TOKEN_PATTERN.test(token)) {
    return (
      <div className="text-center py-16">
        <h2 className="text-xl font-medium text-charcoal">Link inválido</h2>
        <p className="text-mid mt-2">O link informado não é válido.</p>
      </div>
    )
  }

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

  const rendered = (tokenData.renderedContents ?? {}) as Record<string, string>
  const firstName = tokenData.patientName?.split(' ')[0] ?? 'Paciente'

  return (
    <RemoteConsentSigning
      token={token}
      firstName={firstName}
      templates={templates.map((t) => ({
        id: t.id,
        type: t.type,
        title: t.title,
        content: rendered[t.id] ?? t.content,
        version: t.version,
      }))}
    />
  )
}

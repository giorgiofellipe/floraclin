import { getValidToken } from '@/db/queries/anamnesis-tokens'
import { PublicAnamnesisPage } from '@/components/anamnesis/public-anamnesis-page'

export default async function AnamnesisTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const tokenData = await getValidToken(token)

  if (!tokenData) {
    return (
      <div className="text-center py-16">
        <h2 className="text-xl font-medium text-charcoal">Link expirado</h2>
        <p className="text-mid mt-2">Este link não é mais válido. Solicite um novo na recepção.</p>
      </div>
    )
  }

  const firstName = tokenData.patientName?.split(' ')[0] ?? 'Paciente'

  return <PublicAnamnesisPage firstName={firstName} token={token} patientId={tokenData.patientId} />
}

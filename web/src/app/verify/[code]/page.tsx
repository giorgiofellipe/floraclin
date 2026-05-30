import { findByVerificationCode } from '@/db/queries/consent'
import { verifyEvidencePackage, type SignatureEvidence } from '@/lib/signature-evidence'
import { formatInTimeZone } from 'date-fns-tz'
import { ptBR } from 'date-fns/locale'

const VERIFICATION_CODE_PATTERN = /^FLC-[0-9A-F]{12}$/

const TYPE_LABELS: Record<string, string> = {
  general: 'Termo de Consentimento',
  botox: 'Termo — Toxina Botulínica',
  filler: 'Termo — Preenchedor',
  biostimulator: 'Termo — Bioestimulador',
  limpeza_pele: 'Termo — Limpeza de Pele',
  enzima: 'Termo — Enzima Lipolítica',
  skinbooster: 'Termo — Skinbooster',
  microagulhamento: 'Termo — Microagulhamento',
  custom: 'Termo Personalizado',
  service_contract: 'Contrato de Serviços',
}

export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params

  if (!VERIFICATION_CODE_PATTERN.test(code)) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
        <h2 className="text-lg font-medium text-red-800">Código inválido</h2>
        <p className="mt-2 text-sm text-red-600">
          O formato do código de verificação não é válido.
        </p>
      </div>
    )
  }

  const acceptance = await findByVerificationCode(code)

  if (!acceptance) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-red-100">
          <svg className="size-7 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="text-lg font-medium text-red-800">Documento não encontrado</h2>
        <p className="mt-2 text-sm text-red-600">
          O código de verificação informado não corresponde a nenhum documento registrado.
        </p>
      </div>
    )
  }

  const evidence = acceptance.signatureEvidence as SignatureEvidence | null
  let verification = { valid: false, details: 'Pacote de evidência não disponível' }

  if (evidence && acceptance.contentSnapshot && acceptance.signatureData) {
    verification = await verifyEvidencePackage(
      acceptance.contentSnapshot,
      acceptance.signatureData,
      evidence,
    )
  }

  return (
    <div className="space-y-6">
      <div className={`rounded-lg border p-8 text-center ${verification.valid ? 'border-sage/30 bg-[#F0F7F1]' : 'border-red-200 bg-red-50'}`}>
        <div className={`mx-auto mb-4 flex size-14 items-center justify-center rounded-full ${verification.valid ? 'bg-mint/20' : 'bg-red-100'}`}>
          {verification.valid ? (
            <svg className="size-7 text-sage" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          ) : (
            <svg className="size-7 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
          )}
        </div>
        <h2 className={`text-lg font-medium ${verification.valid ? 'text-sage' : 'text-red-800'}`}>
          {verification.valid ? 'Documento autêntico e íntegro' : 'Documento adulterado ou não encontrado'}
        </h2>
        <p className={`mt-1 text-sm ${verification.valid ? 'text-mid' : 'text-red-600'}`}>
          {verification.details}
        </p>
      </div>

      <div className="rounded-lg border border-[#E8ECEF] bg-white p-6 space-y-3">
        <h3 className="text-sm font-medium text-charcoal uppercase tracking-wider">Detalhes do documento</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-mid">Tipo</span>
            <p className="font-medium text-charcoal">{TYPE_LABELS[acceptance.templateType] ?? acceptance.templateType}</p>
          </div>
          <div>
            <span className="text-mid">Título</span>
            <p className="font-medium text-charcoal">{acceptance.templateTitle}</p>
          </div>
          <div>
            <span className="text-mid">Data da assinatura</span>
            <p className="font-medium text-charcoal">{formatInTimeZone(acceptance.acceptedAt, 'America/Sao_Paulo', "d 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}</p>
          </div>
          <div>
            <span className="text-mid">Método</span>
            <p className="font-medium text-charcoal">{acceptance.acceptanceMethod === 'both' ? 'Checkbox + Assinatura' : acceptance.acceptanceMethod === 'signature' ? 'Assinatura' : 'Checkbox'}</p>
          </div>
          <div>
            <span className="text-mid">Código</span>
            <p className="font-medium text-charcoal font-mono">{acceptance.verificationCode}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

import { findByVerificationCode } from '@/db/queries/consent'
import { findClinicalDocumentByVerificationCode } from '@/db/queries/clinical-documents'
import { verifyEvidencePackage, type SignatureEvidence } from '@/lib/signature-evidence'
import { formatInTimeZone } from 'date-fns-tz'
import { ptBR } from 'date-fns/locale'
import type { ProfessionalSnapshot } from '@/validations/clinical-document'
import { DocumentPreview } from '@/components/clinical-documents/document-preview'
import { PrintConsent } from '@/components/consent/print-consent'

const VERIFICATION_CODE_PATTERN = /^FLC-[0-9A-F]{12}$/

const CONSENT_TYPE_LABELS: Record<string, string> = {
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

const DOC_KIND_LABELS: Record<string, string> = {
  receita: 'Receita',
  atestado: 'Atestado',
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

  const [acceptance, clinicalDoc] = await Promise.all([
    findByVerificationCode(code),
    findClinicalDocumentByVerificationCode(code),
  ])

  if (acceptance) {
    return <ConsentVerification acceptance={acceptance} />
  }

  if (clinicalDoc) {
    return <ClinicalDocumentVerification doc={clinicalDoc} />
  }

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

function ConsentVerification({ acceptance }: { acceptance: NonNullable<Awaited<ReturnType<typeof findByVerificationCode>>> }) {
  return <ConsentVerificationInner acceptance={acceptance} />
}

async function ConsentVerificationInner({ acceptance }: { acceptance: NonNullable<Awaited<ReturnType<typeof findByVerificationCode>>> }) {
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
      <VerificationBanner valid={verification.valid} details={verification.details} />

      <div className="rounded-lg border border-[#E8ECEF] bg-[#F4F6F8] p-4">
        <h3 className="text-sm font-medium text-charcoal uppercase tracking-wider mb-3">Documento</h3>
        <PrintConsent
          acceptance={{
            contentSnapshot: acceptance.contentSnapshot,
            contentHash: acceptance.contentHash,
            signatureData: acceptance.signatureData,
            signatureEvidence: acceptance.signatureEvidence,
            professionalSnapshot: acceptance.professionalSnapshot,
            verificationCode: acceptance.verificationCode,
            acceptedAt: acceptance.acceptedAt,
            acceptanceMethod: acceptance.acceptanceMethod,
            templateTitle: acceptance.templateTitle,
            templateType: acceptance.templateType,
            templateVersion: acceptance.templateVersion,
            patientName: acceptance.patientName,
            patientCpf: acceptance.patientCpf,
            tenantName: acceptance.tenantName,
            tenantPhone: acceptance.tenantPhone,
            tenantEmail: acceptance.tenantEmail,
            tenantLogoUrl: acceptance.tenantLogoUrl,
            tenantAddress: (acceptance.tenantAddress ?? null) as Record<string, unknown> | null,
          }}
        />
      </div>
    </div>
  )
}

function ClinicalDocumentVerification({ doc }: { doc: NonNullable<Awaited<ReturnType<typeof findClinicalDocumentByVerificationCode>>> }) {
  const snapshot = doc.professionalSnapshot as ProfessionalSnapshot
  const tenantAddress = (doc.tenantAddress ?? null) as Record<string, string | undefined> | null

  return (
    <div className="space-y-6">
      <VerificationBanner valid={true} details="Documento registrado e verificado no sistema FloraClin" />

      <div className="rounded-lg border border-[#E8ECEF] bg-white p-6 space-y-3">
        <h3 className="text-sm font-medium text-charcoal uppercase tracking-wider">Detalhes do documento</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-mid">Tipo</span>
            <p className="font-medium text-charcoal">{DOC_KIND_LABELS[doc.kind] ?? doc.kind}</p>
          </div>
          <div>
            <span className="text-mid">Título</span>
            <p className="font-medium text-charcoal">{doc.title}</p>
          </div>
          <div>
            <span className="text-mid">Paciente</span>
            <p className="font-medium text-charcoal">{doc.patientName}</p>
          </div>
          <div>
            <span className="text-mid">Clínica</span>
            <p className="font-medium text-charcoal">{doc.tenantName}</p>
          </div>
          <div>
            <span className="text-mid">Profissional</span>
            <p className="font-medium text-charcoal">{snapshot.name}</p>
            <p className="text-xs text-mid">{snapshot.registryLine}</p>
          </div>
          <div>
            <span className="text-mid">Data de emissão</span>
            <p className="font-medium text-charcoal">{formatInTimeZone(doc.issuedAt, 'America/Sao_Paulo', "d 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}</p>
          </div>
          <div>
            <span className="text-mid">Código</span>
            <p className="font-medium text-charcoal font-mono">{doc.verificationCode}</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[#E8ECEF] bg-[#F4F6F8] p-4">
        <h3 className="text-sm font-medium text-charcoal uppercase tracking-wider mb-3">Documento</h3>
        <DocumentPreview
          kind={doc.kind as 'receita' | 'atestado'}
          title={doc.title}
          body={doc.body}
          date={doc.issuedAt}
          patient={{
            fullName: doc.patientName,
            cpf: doc.patientCpf,
            birthDate: doc.patientBirthDate,
          }}
          practitioner={{
            displayName: snapshot.name,
            registryLine: snapshot.registryLine,
            signatureDataUrl: snapshot.signatureDataUrl,
          }}
          tenant={{
            name: doc.tenantName,
            phone: doc.tenantPhone,
            email: doc.tenantEmail,
            logoUrl: doc.tenantLogoUrl,
            address: tenantAddress,
          }}
        />
      </div>
    </div>
  )
}

function VerificationBanner({ valid, details }: { valid: boolean; details: string }) {
  return (
    <div className={`rounded-lg border p-8 text-center ${valid ? 'border-sage/30 bg-[#F0F7F1]' : 'border-red-200 bg-red-50'}`}>
      <div className={`mx-auto mb-4 flex size-14 items-center justify-center rounded-full ${valid ? 'bg-mint/20' : 'bg-red-100'}`}>
        {valid ? (
          <svg className="size-7 text-sage" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
        ) : (
          <svg className="size-7 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
          </svg>
        )}
      </div>
      <h2 className={`text-lg font-medium ${valid ? 'text-sage' : 'text-red-800'}`}>
        {valid ? 'Documento autêntico e íntegro' : 'Verificação falhou'}
      </h2>
      <p className={`mt-1 text-sm ${valid ? 'text-mid' : 'text-red-600'}`}>
        {details}
      </p>
    </div>
  )
}

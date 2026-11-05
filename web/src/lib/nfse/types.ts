export type NfseEnvironment = 'production' | 'restricted'
export type NfseEmissionMode = 'ask' | 'always'
export type NfseDocumentStatus = 'pending' | 'processing' | 'issued' | 'failed' | 'cancelled'
export type NfseServicePresetId = 'odontologia' | 'medicina' | 'biomedicina' | 'enfermagem' | 'estetica'
export type NfseCompetenceChoice = 'service' | 'today'
export type NfseCancelReason = 1 | 2 | 9

export interface NfseCertificateInfo {
  cnpj: string
  subject: string
  issuer: string
  validFrom: string
  validTo: string
}

export interface NfseServiceCodes {
  cTribNac: string
  cNBS: string
  tribISSQN: 1 | 2 | 3 | 4
  cIndOp: string
  CST: string
  cClassTrib: string
}

export interface NfseFiscalSettingsInput {
  municipalityCode: string
  municipalRegistration: string | null
  simplesNacionalOption: 1 | 2 | 3
  simplesNacionalRegime: 1 | 2 | 3 | null
  simplesNacionalTaxRate: number | null
  servicePreset: NfseServicePresetId | null
  advancedCodes: NfseServiceCodes | null
  issRate: number | null
  issWithheld: boolean
  emissionMode: NfseEmissionMode
  emailPatient: boolean
  clinicAddressFallback: boolean
}

export interface NfseSettingsPublic extends NfseFiscalSettingsInput {
  certificate: NfseCertificateInfo
  municipalityName: string | null
  configured: boolean
}

export interface NfseSettingsWithSecrets extends NfseSettingsPublic {
  pfxBase64: string
  password: string
}

export interface NfseAddress {
  zip: string
  street: string
  number: string
  complement: string | null
  neighborhood: string
  city: string
  state: string
}

export interface NfseSnapshot {
  environment: NfseEnvironment
  providerCnpj: string
  municipalRegistration: string | null
  municipalityCode: string
  simplesNacionalOption: 1 | 2 | 3
  simplesNacionalRegime: 1 | 2 | 3 | null
  simplesNacionalTaxRate: number | null
  issRate: number | null
  issWithheld: boolean
  service: NfseServiceCodes
  taker: { cpf: string; name: string; email: string | null; address: NfseAddress; cityCode: string }
  description: string
  value: number
  competenceDate: string
  series: string
  dpsNumber: string
}

export interface NfseDocumentSummary {
  id: string
  paymentRecordId: string
  status: NfseDocumentStatus
  errorCode: string | null
  errorMessage: string | null
  nfseNumber: string | null
  competenceDate: string
  emailSentAt: string | null
  cancelRequested: boolean
  retryable: boolean
}

/** The list filter's statuses: 'processing' covers pending and processing. */
export type NfseListStatus = 'issued' | 'cancelled' | 'failed' | 'processing'

export interface NfseDocumentListItem {
  id: string
  paymentRecordId: string
  nfseNumber: string | null
  status: NfseDocumentStatus
  cancelRequested: boolean
  issuedAt: string | null
  createdAt: string
  competenceDate: string
  value: number
  patientId: string
  patientName: string
  errorMessage: string | null
  retryable: boolean
  emailSentAt: string | null
  environment: NfseEnvironment
}

export interface NfseProcessResult {
  id: string
  status: NfseDocumentStatus
  errorCode?: string
  errorMessage?: string
}

export interface NfseEmissionResult extends NfseProcessResult {
  paymentRecordId: string
  nfseNumber: string | null
  patientName: string
  value: number
  email: string | null
  emailRequested: boolean
  emailSent: boolean
}

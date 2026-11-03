import { CertificateError, loadCertificate } from '@bullcode/fiscal'
import { BusinessError } from '@/lib/errors'
import type { NfseCertificateInfo } from './types'

export function readCertificate(pfxBase64: string, password: string, now = new Date()): NfseCertificateInfo {
  let parsed: ReturnType<typeof loadCertificate>
  try {
    parsed = loadCertificate(Buffer.from(pfxBase64, 'base64'), password)
  } catch (error) {
    if (error instanceof CertificateError) throw new BusinessError('CERTIFICATE_INVALID', error.message)
    throw error
  }
  if (parsed.validTo <= now) {
    throw new BusinessError('CERTIFICATE_EXPIRED', 'O certificado está vencido.')
  }
  if (parsed.validFrom > now) {
    throw new BusinessError('CERTIFICATE_NOT_YET_VALID', 'O certificado ainda não é válido.')
  }
  return {
    cnpj: parsed.cnpj,
    subject: parsed.subjectName,
    issuer: parsed.issuerName,
    validFrom: parsed.validFrom.toISOString(),
    validTo: parsed.validTo.toISOString(),
  }
}

export interface DeviceFingerprint {
  screen: string
  timezone: string
  language: string
}

export interface Geolocation {
  lat: number
  lng: number
}

export interface SignatureEvidence {
  version: 1
  contentHash: string
  signatureHash: string
  evidenceHash: string
  signerCpf: string
  ipAddress: string
  userAgent: string
  signedAt: string
  deviceFingerprint: DeviceFingerprint
  geolocation?: Geolocation
  timestampToken?: string
}

export interface EvidenceResult {
  evidence: SignatureEvidence
  verificationCode: string
}

export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

function maskCpf(cpf: string): string {
  const digits = cpf.replace(/\D/g, '')
  if (digits.length < 11) return cpf
  return `***.***.*${digits.slice(7, 9)}-${digits.slice(9, 11)}`
}

export function deriveVerificationCode(evidenceHash: string): string {
  const raw = evidenceHash.replace('sha256:', '')
  return `FLC-${raw.slice(0, 12).toUpperCase()}`
}

export async function buildEvidencePackage(input: {
  contentText: string
  signatureData: string
  signerCpf: string
  ipAddress: string
  userAgent: string
  deviceFingerprint: DeviceFingerprint
  geolocation?: Geolocation
}): Promise<EvidenceResult> {
  const contentHash = `sha256:${await sha256(input.contentText)}`
  const signatureHash = `sha256:${await sha256(input.signatureData)}`

  const signedAt = new Date().toISOString()
  const maskedCpf = maskCpf(input.signerCpf)
  const rawEvidenceInput = [
    contentHash,
    signatureHash,
    maskedCpf,
    input.ipAddress,
    input.userAgent,
    signedAt,
  ].join('|')

  const evidenceHashHex = await sha256(rawEvidenceInput)
  const evidenceHash = `sha256:${evidenceHashHex}`

  const timestampToken = await fetchTimestampToken(evidenceHashHex).catch(() => undefined)

  const evidence: SignatureEvidence = {
    version: 1,
    contentHash,
    signatureHash,
    evidenceHash,
    signerCpf: maskCpf(input.signerCpf),
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    signedAt,
    deviceFingerprint: input.deviceFingerprint,
    ...(input.geolocation ? { geolocation: input.geolocation } : {}),
    ...(timestampToken ? { timestampToken } : {}),
  }

  return {
    evidence,
    verificationCode: deriveVerificationCode(evidenceHashHex),
  }
}

export async function verifyEvidencePackage(
  contentText: string,
  signatureData: string,
  evidence: SignatureEvidence,
): Promise<{ valid: boolean; details: string }> {
  const recomputedContentHash = `sha256:${await sha256(contentText)}`
  if (recomputedContentHash !== evidence.contentHash) {
    return { valid: false, details: 'Conteúdo do documento foi alterado' }
  }

  const recomputedSignatureHash = `sha256:${await sha256(signatureData)}`
  if (recomputedSignatureHash !== evidence.signatureHash) {
    return { valid: false, details: 'Assinatura foi alterada' }
  }

  // Recompute evidence hash to verify full chain integrity
  const rawEvidenceInput = [
    recomputedContentHash,
    recomputedSignatureHash,
    evidence.signerCpf,
    evidence.ipAddress,
    evidence.userAgent,
    evidence.signedAt,
  ].join('|')
  const recomputedEvidenceHash = `sha256:${await sha256(rawEvidenceInput)}`
  if (recomputedEvidenceHash !== evidence.evidenceHash) {
    return { valid: false, details: 'Cadeia de evidência comprometida' }
  }

  return { valid: true, details: 'Documento autêntico e íntegro' }
}

async function fetchTimestampToken(evidenceHash: string): Promise<string | undefined> {
  try {
    const hashBytes = new Uint8Array(evidenceHash.match(/.{2}/g)!.map((b) => parseInt(b, 16)))

    const tsqBody = buildTimestampQuery(hashBytes)
    const res = await fetch('https://freetsa.org/tsr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query' },
      body: tsqBody.buffer as ArrayBuffer,
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return undefined
    const buf = new Uint8Array(await res.arrayBuffer())
    let binary = ''
    for (const byte of buf) binary += String.fromCharCode(byte)
    return btoa(binary)
  } catch {
    return undefined
  }
}

function buildTimestampQuery(hashBytes: Uint8Array): Uint8Array {
  // Minimal DER-encoded RFC 3161 TimeStampReq:
  // SEQUENCE { version INTEGER 1, messageImprint SEQUENCE { algorithm AlgorithmIdentifier(SHA-256), hashedMessage OCTET STRING } }
  const sha256Oid = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00])
  const hashOctet = new Uint8Array([0x04, hashBytes.length, ...hashBytes])
  const messageImprint = new Uint8Array([0x30, sha256Oid.length + hashOctet.length, ...sha256Oid, ...hashOctet])
  const versionInt = new Uint8Array([0x02, 0x01, 0x01])
  const body = new Uint8Array([...versionInt, ...messageImprint])
  return new Uint8Array([0x30, body.length, ...body])
}

// Client-only — guard against server-side import
export function collectDeviceFingerprint(): DeviceFingerprint {
  if (typeof window === 'undefined') {
    return { screen: 'unknown', timezone: 'unknown', language: 'unknown' }
  }
  return {
    screen: `${window.screen.width}x${window.screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: window.navigator.language,
  }
}

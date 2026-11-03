import { generateKeyPairSync } from 'node:crypto'
import forge from 'node-forge'

interface BuildTestPfxOptions {
  cnpj: string
  password: string
  validFrom?: Date
  validTo?: Date
}

/** Self-signed A1 bundle carrying the ICP-Brasil e-CNPJ otherName (OID 2.16.76.1.3.3). */
export function buildTestPfx(options: BuildTestPfxOptions): string {
  const { privateKey: pem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const key = forge.pki.privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey

  const cert = forge.pki.createCertificate()
  cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e)
  cert.serialNumber = '01'
  cert.validity.notBefore = options.validFrom ?? new Date(Date.now() - 24 * 60 * 60 * 1000)
  cert.validity.notAfter = options.validTo ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  cert.setSubject([{ shortName: 'CN', value: `EMPRESA TESTE LTDA:${options.cnpj}` }])
  cert.setIssuer([{ shortName: 'CN', value: 'AC TESTE' }])

  const { asn1 } = forge
  const otherName = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('2.16.76.1.3.3').getBytes()),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, options.cnpj),
    ]),
  ])
  const san = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [otherName])
  cert.setExtensions([{ id: '2.5.29.17', value: asn1.toDer(san).getBytes() }])
  cert.sign(key, forge.md.sha256.create())

  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], options.password, { algorithm: '3des' })
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary').toString('base64')
}

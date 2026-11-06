// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto'
import forge from 'node-forge'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SefinError } from '@bullcode/fiscal/nfse'
import type { NfseSettingsWithSecrets, NfseSnapshot } from '../types'

const sefin = vi.hoisted(() => ({
  emit: vi.fn(),
  findAccessKeyByDpsId: vi.fn(),
  getNfseXml: vi.fn(),
  registerEvent: vi.fn(),
}))

vi.mock('@bullcode/fiscal/nfse', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@bullcode/fiscal/nfse')>()),
  SefinClient: vi.fn(function SefinClient() {
    return sefin
  }),
}))

import { createNfseGateway, NfseGatewayError } from '../gateway'

const CNPJ = '64643544000154'
const PASSWORD = 'x'
const ACCESS_KEY = '42082032264643544000154000000000000426100762796533'

function makePfx(cnpj: string, notAfter: Date): string {
  const { privateKey: pem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const key = forge.pki.privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey
  const cert = forge.pki.createCertificate()
  cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e)
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
  cert.validity.notAfter = notAfter
  cert.setSubject([{ shortName: 'CN', value: `CLINICA TESTE LTDA:${cnpj}` }])
  cert.setIssuer([{ shortName: 'CN', value: 'AC TESTE' }])
  const { asn1 } = forge
  const otherName = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('2.16.76.1.3.3').getBytes()),
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, cnpj),
    ]),
  ])
  const san = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [otherName])
  cert.setExtensions([{ id: '2.5.29.17', value: asn1.toDer(san).getBytes() }])
  cert.sign(key, forge.md.sha256.create())
  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], PASSWORD, { algorithm: '3des' })
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary').toString('base64')
}

const validPfx = makePfx(CNPJ, new Date(Date.now() + 365 * 24 * 60 * 60 * 1000))

function settings(pfxBase64 = validPfx): NfseSettingsWithSecrets {
  return {
    certificate: { cnpj: CNPJ, subject: 's', issuer: 'i', validFrom: '2026-01-01T00:00:00.000Z', validTo: '2027-01-01T00:00:00.000Z' },
    municipalityCode: '3550308',
    municipalityName: 'São Paulo',
    municipalRegistration: null,
    simplesNacionalOption: 3,
    simplesNacionalRegime: 1,
    simplesNacionalTaxRate: 6,
    servicePreset: 'estetica',
    advancedCodes: null,
    issRate: 2,
    issWithheld: false,
    emissionMode: 'ask',
    emailPatient: false,
    clinicAddressFallback: false,
    configured: true,
    pfxBase64,
    password: PASSWORD,
  }
}

const snapshot: NfseSnapshot = {
  environment: 'restricted',
  providerCnpj: CNPJ,
  municipalRegistration: null,
  municipalityCode: '3550308',
  simplesNacionalOption: 3,
  simplesNacionalRegime: 1,
  simplesNacionalTaxRate: 6,
  issRate: 2,
  issWithheld: false,
  service: { cTribNac: '060201', cNBS: '126029000', tribISSQN: 1, cIndOp: '100301', CST: '000', cClassTrib: '000001' },
  taker: {
    cpf: '52998224725',
    name: 'Maria Souza',
    email: 'maria@example.com',
    address: { zip: '01310100', street: 'Av. Paulista', number: '1000', complement: null, neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP' },
    cityCode: '3550308',
  },
  description: 'Limpeza de pele',
  value: 150.5,
  competenceDate: '2026-10-30',
  series: '00800',
  dpsNumber: '42',
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]

const nfseXml = (over: { taker?: string; vServ?: string; dCompet?: string; desc?: string } = {}) =>
  `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${ACCESS_KEY}"><nNFSe>7</nNFSe><DPS><infDPS>` +
  `<dCompet>${over.dCompet ?? snapshot.competenceDate}</dCompet><toma><CPF>${over.taker ?? snapshot.taker.cpf}</CPF></toma>` +
  `<serv><cServ><xDescServ>${over.desc ?? snapshot.description}</xDescServ></cServ></serv>` +
  `<valores><vServPrest><vServ>${over.vServ ?? '150.50'}</vServ></vServPrest></valores>` +
  `</infDPS></DPS></infNFSe></NFSe>`

const duplicate = () => new SefinError('rejected', [{ code: 'E0014', description: 'DPS duplicada' }], 400)

beforeEach(() => {
  vi.clearAllMocks()
  sefin.emit.mockResolvedValue({ accessKey: ACCESS_KEY, nfseXml: nfseXml(), dpsId: '', alerts: [] })
})

describe('createNfseGateway', () => {
  it('builds a CPF taker DPS with indFinal 1 and backdated dhEmi', async () => {
    const before = Date.now()
    await createNfseGateway(settings(), 'restricted').emit(snapshot)
    const after = Date.now()

    const xml: string = sefin.emit.mock.calls[0][0]
    expect(xml).toContain('<Signature')
    const dhEmi = Date.parse(tag(xml, 'dhEmi')!)
    expect(dhEmi).toBeGreaterThanOrEqual(before - 60_000 - 1000)
    expect(dhEmi).toBeLessThanOrEqual(after - 60_000)
    expect({
      CPF: tag(xml, 'CPF'),
      indFinal: tag(xml, 'indFinal'),
      tpAmb: tag(xml, 'tpAmb'),
      pTotTribSN: tag(xml, 'pTotTribSN'),
      pAliq: tag(xml, 'pAliq'),
      vServ: tag(xml, 'vServ'),
    }).toEqual({ CPF: '52998224725', indFinal: '1', tpAmb: '2', pTotTribSN: '6.00', pAliq: undefined, vServ: '150.50' })
  })

  it('states the municipal ISS rate only for a non-optant', async () => {
    await createNfseGateway(settings(), 'restricted').emit({
      ...snapshot,
      simplesNacionalOption: 1,
      simplesNacionalRegime: null,
      simplesNacionalTaxRate: null,
    })
    const xml: string = sefin.emit.mock.calls[0][0]
    expect({ pAliq: tag(xml, 'pAliq'), pTotTribSN: tag(xml, 'pTotTribSN'), indTotTrib: tag(xml, 'indTotTrib') }).toEqual({
      pAliq: '2.00',
      pTotTribSN: undefined,
      indTotTrib: '0',
    })
  })

  it('maps a rejection to invalid_request with the first Sefin message', async () => {
    sefin.emit.mockRejectedValue(
      new SefinError('rejected', [{ code: 'E0001', description: 'CEP inválido' }, { code: 'E0002', description: 'outra' }], 400),
    )
    const error = await createNfseGateway(settings(), 'restricted').emit(snapshot).catch((e) => e)
    expect(error).toBeInstanceOf(NfseGatewayError)
    expect(error).toMatchObject({ code: 'invalid_request', message: 'E0001: CEP inválido' })
  })

  it('maps an unavailable Sefin to provider_error with the retry message', async () => {
    sefin.emit.mockRejectedValue(new SefinError('unavailable', [], 503))
    const error = await createNfseGateway(settings(), 'restricted').emit(snapshot).catch((e) => e)
    expect(error).toMatchObject({ code: 'provider_error', message: 'Sefin Nacional indisponível. Tentaremos de novo.' })
  })

  it('adopts an E0014 duplicate only when all four fields match', async () => {
    sefin.findAccessKeyByDpsId.mockResolvedValue(ACCESS_KEY)
    sefin.emit.mockRejectedValue(duplicate())
    const gateway = createNfseGateway(settings(), 'restricted')

    sefin.getNfseXml.mockResolvedValue(nfseXml())
    await expect(gateway.emit(snapshot)).resolves.toMatchObject({ accessKey: ACCESS_KEY })

    const mismatches = [
      { taker: '11144477735' },
      { vServ: '150.51' },
      { dCompet: '2026-10-28' },
      { desc: 'Outro serviço' },
    ]
    for (const mismatch of mismatches) {
      sefin.getNfseXml.mockResolvedValue(nfseXml(mismatch))
      await expect(gateway.emit(snapshot)).rejects.toMatchObject({ code: 'reconcile_ambiguous' })
    }
  })

  it('treats an E0014 whose note Sefin cannot find yet as transient', async () => {
    sefin.emit.mockRejectedValue(duplicate())
    sefin.findAccessKeyByDpsId.mockResolvedValue(null)
    await expect(createNfseGateway(settings(), 'restricted').emit(snapshot)).rejects.toMatchObject({ code: 'provider_error' })
  })

  it('moves dCompet back to the BR day of dhEmi in the first minute after BR midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-03T03:00:30Z'))
    try {
      await createNfseGateway(settings(), 'restricted').emit({ ...snapshot, competenceDate: '2026-11-03' })
    } finally {
      vi.useRealTimers()
    }
    expect(tag(sefin.emit.mock.calls[0][0], 'dCompet')).toBe('2026-11-02')
  })

  it('refuses to sign for another CNPJ', async () => {
    const error = await createNfseGateway(settings(), 'restricted')
      .emit({ ...snapshot, providerCnpj: '11222333000181' })
      .catch((e) => e)
    expect(error).toMatchObject({ code: 'unauthorized' })
    expect(sefin.emit).not.toHaveBeenCalled()
  })

  it('refuses an expired certificate at creation', () => {
    const expired = makePfx(CNPJ, new Date(Date.now() - 60_000))
    expect(() => createNfseGateway(settings(expired), 'restricted')).toThrow(
      expect.objectContaining({ code: 'certificate_expired' }),
    )
  })
})

describe('reconcile', () => {
  it('reports not_found when Sefin never authorized the DPS', async () => {
    sefin.findAccessKeyByDpsId.mockResolvedValue(null)
    await expect(createNfseGateway(settings(), 'restricted').reconcile(snapshot)).resolves.toEqual({ kind: 'not_found' })
    expect(sefin.findAccessKeyByDpsId).toHaveBeenCalledWith('DPS355030826464354400015400800000000000000042')
  })

  it('adopts a note whose dCompet was moved back a day at emission', async () => {
    sefin.findAccessKeyByDpsId.mockResolvedValue(ACCESS_KEY)
    sefin.getNfseXml.mockResolvedValue(nfseXml({ dCompet: '2026-10-29' }))
    await expect(createNfseGateway(settings(), 'restricted').reconcile(snapshot)).resolves.toMatchObject({ kind: 'issued' })
  })
})

describe('cancel', () => {
  it('treats E0840 as already cancelled', async () => {
    sefin.registerEvent.mockRejectedValue(new SefinError('rejected', [{ code: 'E0840', description: 'já cancelada' }], 400))
    await expect(
      createNfseGateway(settings(), 'restricted').cancel(ACCESS_KEY, 2, 'Pagamento estornado no FloraClin.'),
    ).resolves.toBeUndefined()
  })

  it('surfaces any other Sefin failure', async () => {
    sefin.registerEvent.mockRejectedValue(new SefinError('unavailable', [], 503))
    await expect(
      createNfseGateway(settings(), 'restricted').cancel(ACCESS_KEY, 2, 'Pagamento estornado no FloraClin.'),
    ).rejects.toMatchObject({ code: 'provider_error' })
  })
})

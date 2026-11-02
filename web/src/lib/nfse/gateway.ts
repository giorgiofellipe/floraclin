import { CertificateError, loadCertificate, type Certificate } from '@bullcode/fiscal'
import {
  buildCancellation,
  buildDps,
  dpsId,
  readNfseSummary,
  SefinClient,
  SefinError,
  signDps,
  type DpsInput,
} from '@bullcode/fiscal/nfse'
import { NFSE_APP_VERSION, NFSE_CLOCK_SKEW_MS } from './config'
import type { NfseCancelReason, NfseEnvironment, NfseSettingsWithSecrets, NfseSnapshot } from './types'

const DPS_ALREADY_ISSUED = 'E0014'
const ALREADY_CANCELLED = 'E0840'
const UNAVAILABLE_MESSAGE = 'Sefin Nacional indisponível. Tentaremos de novo.'
const AMBIGUOUS_MESSAGE =
  'Já existe uma NFS-e com este número de DPS que não corresponde a este pagamento. Verifique manualmente.'

export type NfseGatewayErrorCode =
  | 'provider_error'
  | 'invalid_request'
  | 'unauthorized'
  | 'certificate_expired'
  | 'not_configured'
  | 'reconcile_ambiguous'

export class NfseGatewayError extends Error {
  constructor(
    public readonly code: NfseGatewayErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'NfseGatewayError'
  }
}

export type NfseReconcileResult =
  | { kind: 'issued'; accessKey: string; nfseXml: string }
  | { kind: 'not_found' }
  | { kind: 'ambiguous' }

export interface NfseGateway {
  emit(snapshot: NfseSnapshot): Promise<{ accessKey: string; nfseXml: string }>
  reconcile(snapshot: NfseSnapshot): Promise<NfseReconcileResult>
  cancel(accessKey: string, reason: NfseCancelReason, justification: string): Promise<void>
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof SefinError && error.messages.some((m) => m.code === code)
}

function toGatewayError(error: unknown): NfseGatewayError {
  if (error instanceof NfseGatewayError) return error
  if (error instanceof SefinError && error.kind === 'rejected') {
    const first = error.messages[0]
    return new NfseGatewayError(
      'invalid_request',
      first ? `${first.code}: ${first.description}` : 'A Sefin Nacional rejeitou a nota.',
    )
  }
  if (error instanceof RangeError) return new NfseGatewayError('invalid_request', error.message)
  return new NfseGatewayError('provider_error', UNAVAILABLE_MESSAGE)
}

function loadValidCertificate(settings: NfseSettingsWithSecrets): Certificate {
  let certificate: Certificate
  try {
    certificate = loadCertificate(Buffer.from(settings.pfxBase64, 'base64'), settings.password)
  } catch (error) {
    if (error instanceof CertificateError) {
      throw new NfseGatewayError('not_configured', 'Não foi possível ler o certificado digital. Envie-o novamente.')
    }
    throw error
  }
  if (certificate.validTo.getTime() <= Date.now()) {
    throw new NfseGatewayError('certificate_expired', 'O certificado digital expirou. Envie um certificado válido.')
  }
  return certificate
}

function toDpsInput(snapshot: NfseSnapshot, environment: NfseEnvironment): DpsInput {
  const { taker, service } = snapshot
  const isMeEpp = snapshot.simplesNacionalOption === 3
  return {
    environment,
    dhEmi: new Date(Date.now() - NFSE_CLOCK_SKEW_MS),
    dCompet: snapshot.competenceDate,
    serie: snapshot.series,
    nDPS: snapshot.dpsNumber,
    cLocEmi: snapshot.municipalityCode,
    verAplic: NFSE_APP_VERSION,
    prest: {
      CNPJ: snapshot.providerCnpj,
      IM: snapshot.municipalRegistration ?? undefined,
      regTrib: {
        opSimpNac: snapshot.simplesNacionalOption,
        regApTribSN: isMeEpp ? (snapshot.simplesNacionalRegime ?? undefined) : undefined,
        regEspTrib: 0,
      },
    },
    toma: {
      CPF: taker.cpf,
      xNome: taker.name,
      email: taker.email ?? undefined,
      end: {
        cMun: taker.cityCode,
        CEP: taker.address.zip,
        xLgr: taker.address.street,
        nro: taker.address.number,
        xCpl: taker.address.complement ?? undefined,
        xBairro: taker.address.neighborhood,
      },
    },
    serv: {
      cLocPrestacao: snapshot.municipalityCode,
      cTribNac: service.cTribNac,
      cNBS: service.cNBS,
      xDescServ: snapshot.description,
    },
    valores: {
      vServ: snapshot.value,
      tribISSQN: service.tribISSQN,
      tpRetISSQN: snapshot.issWithheld ? 2 : 1,
      pAliq:
        snapshot.simplesNacionalOption === 1 && service.tribISSQN === 1
          ? (snapshot.issRate ?? undefined)
          : undefined,
      totTrib:
        isMeEpp && snapshot.simplesNacionalTaxRate !== null
          ? { pTotTribSN: snapshot.simplesNacionalTaxRate }
          : { indTotTrib: 0 },
    },
    IBSCBS: {
      indFinal: 1,
      cIndOp: service.cIndOp,
      indDest: 0,
      CST: service.CST,
      cClassTrib: service.cClassTrib,
    },
  }
}

export function createNfseGateway(settings: NfseSettingsWithSecrets, environment: NfseEnvironment): NfseGateway {
  const certificate = loadValidCertificate(settings)
  const client = new SefinClient({ environment, certificate })

  async function reconcile(snapshot: NfseSnapshot): Promise<NfseReconcileResult> {
    try {
      const accessKey = await client.findAccessKeyByDpsId(
        dpsId({
          cLocEmi: snapshot.municipalityCode,
          CNPJ: snapshot.providerCnpj,
          serie: snapshot.series,
          nDPS: snapshot.dpsNumber,
        }),
      )
      if (!accessKey) return { kind: 'not_found' }
      const nfseXml = await client.getNfseXml(accessKey)
      const found = readNfseSummary(nfseXml)
      const matches =
        found.takerDocument === snapshot.taker.cpf &&
        found.serviceValueCents === Math.round(snapshot.value * 100) &&
        found.competenceDate === snapshot.competenceDate &&
        found.description === snapshot.description
      return matches ? { kind: 'issued', accessKey, nfseXml } : { kind: 'ambiguous' }
    } catch (error) {
      throw toGatewayError(error)
    }
  }

  return {
    reconcile,

    async emit(snapshot) {
      if (snapshot.providerCnpj !== certificate.cnpj) {
        throw new NfseGatewayError(
          'unauthorized',
          'O certificado digital atual é de outro CNPJ. Esta nota precisa ser emitida com o certificado original.',
        )
      }
      try {
        const dps = buildDps(toDpsInput(snapshot, environment))
        const issued = await client.emit(signDps(dps.xml, certificate))
        return { accessKey: issued.accessKey, nfseXml: issued.nfseXml }
      } catch (error) {
        if (!hasCode(error, DPS_ALREADY_ISSUED)) throw toGatewayError(error)
        const existing = await reconcile(snapshot)
        if (existing.kind === 'issued') return { accessKey: existing.accessKey, nfseXml: existing.nfseXml }
        throw new NfseGatewayError('reconcile_ambiguous', AMBIGUOUS_MESSAGE)
      }
    },

    async cancel(accessKey, reason, justification) {
      try {
        const request = buildCancellation(
          {
            environment,
            accessKey,
            authorCnpj: certificate.cnpj,
            reason,
            description: justification,
            verAplic: NFSE_APP_VERSION,
            at: new Date(),
          },
          certificate,
        )
        await client.registerEvent(accessKey, request)
      } catch (error) {
        if (hasCode(error, ALREADY_CANCELLED)) return
        throw toGatewayError(error)
      }
    },
  }
}

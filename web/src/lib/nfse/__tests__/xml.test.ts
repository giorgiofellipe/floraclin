import { describe, expect, it } from 'vitest'
import { readNfseNumber, reshapeDpsXmlForEnvironment } from '../xml'

describe('readNfseNumber', () => {
  it('reads the number from an authorized NFS-e', () => {
    const xml = '<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00"><infNFSe Id="NFS1"><nNFSe>1</nNFSe></infNFSe></NFSe>'
    expect(readNfseNumber(xml)).toBe('1')
  })

  it('returns null without nNFSe', () => {
    expect(readNfseNumber('<NFSe><infNFSe/></NFSe>')).toBeNull()
  })
})

// Compact DPS body matching @bullcode/fiscal v0.1.1 (NT 009 / produção restrita).
const RESTRICTED_DPS =
  `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="DPS355030826464354400015400800000000000000001">` +
  `<tpAmb>1</tpAmb><dhEmi>2026-11-05T13:46:53-03:00</dhEmi><verAplic>floraclin</verAplic>` +
  `<serie>00800</serie><nDPS>1</nDPS><dCompet>2026-11-05</dCompet><tpEmit>1</tpEmit>` +
  `<finNFSe>0</finNFSe><cLocEmi>3550308</cLocEmi>` +
  `<prest><CNPJ>64643544000154</CNPJ><regTrib><opSimpNac>3</opSimpNac><regEspTrib>0</regEspTrib></regTrib></prest>` +
  `<toma><CPF>52998224725</CPF><xNome>Maria Souza</xNome></toma>` +
  `<serv><locPrest><cLocPrestacao>3550308</cLocPrestacao></locPrest>` +
  `<cServ><cTribNac>060201</cTribNac><cNBS>126029000</cNBS><xDescServ>Limpeza de pele</xDescServ></cServ></serv>` +
  `<valores><vServPrest><vServ>150.50</vServ></vServPrest>` +
  `<trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun><totTrib><indTotTrib>0</indTotTrib></totTrib></trib></valores>` +
  `<IBSCBS><indFinal>1</indFinal><cIndOp>100301</cIndOp><indDest>0</indDest>` +
  `<valores><trib><CST>000</CST><cClassTrib>000001</cClassTrib></trib></valores></IBSCBS></infDPS></DPS>`

describe('reshapeDpsXmlForEnvironment', () => {
  it('leaves produção restrita XML unchanged', () => {
    expect(reshapeDpsXmlForEnvironment(RESTRICTED_DPS, 'restricted')).toBe(RESTRICTED_DPS)
  })

  it('moves finNFSe, reorders cNBS, and wraps CST for the production XSD', () => {
    const xml = reshapeDpsXmlForEnvironment(RESTRICTED_DPS, 'production')
    expect(xml).toContain('<tpEmit>1</tpEmit><cLocEmi>3550308</cLocEmi>')
    expect(xml).not.toContain('<tpEmit>1</tpEmit><finNFSe>0</finNFSe>')
    expect(xml).toContain('<IBSCBS><finNFSe>0</finNFSe><indFinal>1</indFinal>')
    expect(xml).toContain('<cTribNac>060201</cTribNac><xDescServ>Limpeza de pele</xDescServ><cNBS>126029000</cNBS>')
    expect(xml).toContain('<gIBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib></gIBSCBS>')
    expect(xml).not.toContain('<trib><CST>000</CST>')
  })

  it('is idempotent on XML that already matches the production layout', () => {
    const once = reshapeDpsXmlForEnvironment(RESTRICTED_DPS, 'production')
    expect(reshapeDpsXmlForEnvironment(once, 'production')).toBe(once)
  })
})


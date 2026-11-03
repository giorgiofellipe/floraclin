import { describe, expect, it } from 'vitest'
import { readNfseNumber } from '../xml'

describe('readNfseNumber', () => {
  it('reads the number from an authorized NFS-e', () => {
    const xml = '<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00"><infNFSe Id="NFS1"><nNFSe>1</nNFSe></infNFSe></NFSe>'
    expect(readNfseNumber(xml)).toBe('1')
  })

  it('returns null without nNFSe', () => {
    expect(readNfseNumber('<NFSe><infNFSe/></NFSe>')).toBeNull()
  })
})

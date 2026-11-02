import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readNfseNumber } from '../xml'

describe('readNfseNumber', () => {
  it('reads the number from an authorized NFS-e', () => {
    const xml = readFileSync(join(__dirname, 'fixtures', 'nfse-170303.xml'), 'utf8')
    expect(readNfseNumber(xml)).toBe('1')
  })

  it('returns null without nNFSe', () => {
    expect(readNfseNumber('<NFSe><infNFSe/></NFSe>')).toBeNull()
  })
})

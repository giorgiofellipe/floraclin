import type { NfseEnvironment } from './types'

export function readNfseNumber(nfseXml: string): string | null {
  return /<nNFSe>(\d+)<\/nNFSe>/.exec(nfseXml)?.[1] ?? null
}

/**
 * `@bullcode/fiscal` v0.1.1 builds DPS XML for the NT 009 schema used in
 * produção restrita (`NFSe-ESQUEMAS_XSD-PRODREST-v1.01-20261020`). Production
 * Sefin still validates the February 2026 XSD (`NFSe-ESQUEMAS_XSD-v1.01-20260209`),
 * which rejects that layout with E1235. Three sequence differences:
 *   1. `finNFSe` is the first child of `IBSCBS`, not a sibling of `tpEmit`
 *   2. `cNBS` comes after `xDescServ`
 *   3. `CST`/`cClassTrib` are wrapped in `gIBSCBS`
 *
 * Restricted emissions are left unchanged. Drop this adapter when production
 * Sefin switches to the NT 009 XSD.
 */
export function reshapeDpsXmlForEnvironment(xml: string, environment: NfseEnvironment): string {
  return environment === 'production' ? toProductionDpsLayout(xml) : xml
}

function toProductionDpsLayout(xml: string): string {
  let out = xml
  if (/<tpEmit>\d+<\/tpEmit><finNFSe>0<\/finNFSe><cLocEmi>/.test(out) && !out.includes('<IBSCBS><finNFSe>')) {
    out = out.replace('<finNFSe>0</finNFSe>', '').replace('<IBSCBS>', '<IBSCBS><finNFSe>0</finNFSe>')
  }
  out = out.replace(
    /(<cServ><cTribNac>\d+<\/cTribNac>)(<cNBS>\d+<\/cNBS>)(<xDescServ>[\s\S]*?<\/xDescServ>)/,
    '$1$3$2',
  )
  return out.replace(
    /(<IBSCBS>[\s\S]*?<trib>)(?!<gIBSCBS>)(<CST>\d+<\/CST><cClassTrib>\d+<\/cClassTrib>)(<\/trib>)/,
    '$1<gIBSCBS>$2</gIBSCBS>$3',
  )
}

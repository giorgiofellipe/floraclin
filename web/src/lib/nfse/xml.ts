export function readNfseNumber(nfseXml: string): string | null {
  return /<nNFSe>(\d+)<\/nNFSe>/.exec(nfseXml)?.[1] ?? null
}

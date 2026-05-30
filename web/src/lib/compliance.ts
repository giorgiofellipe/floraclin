const PROTECTED_TABLES = [
  'consent_acceptances',
  'procedure_records',
  'evaluation_responses',
  'clinical_documents',
  'anamneses',
  'photo_assets',
] as const

export function assertNotProtectedTable(tableName: string): void {
  if (PROTECTED_TABLES.includes(tableName as typeof PROTECTED_TABLES[number])) {
    throw new Error(
      `Illegal operation: DELETE on '${tableName}' is prohibited (Lei 13.787/2018 — 20-year retention).`,
    )
  }
}

export { PROTECTED_TABLES }

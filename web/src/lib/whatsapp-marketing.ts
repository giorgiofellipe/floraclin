import { isMarketingOptedOut } from '@/db/queries/marketing-consent'

export const MARKETING_OPTED_OUT_ERROR = 'Paciente optou por não receber mensagens promocionais.'

export async function isMarketingBlocked(
  tenantId: string,
  template: { category: string } | null,
  ref: { patientId?: string | null; phone?: string | null },
): Promise<boolean> {
  return template?.category === 'MARKETING' && (await isMarketingOptedOut(tenantId, ref))
}

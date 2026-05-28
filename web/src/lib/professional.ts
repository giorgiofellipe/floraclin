import { db } from '@/db/client'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'

export interface SignatureBlock {
  signatureDataUrl: string
  displayName: string
  registryLine: string // e.g., "CRM-SP 123.456"
}

export async function getSignatureBlock(userId: string): Promise<SignatureBlock | null> {
  const [user] = await db
    .select({
      fullName: users.fullName,
      signatureData: users.signatureData,
      professionalTitle: users.professionalTitle,
      registryType: users.registryType,
      registryNumber: users.registryNumber,
      registryState: users.registryState,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (
    !user ||
    !user.signatureData ||
    !user.registryType ||
    !user.registryNumber ||
    !user.registryState
  ) {
    return null
  }

  return {
    signatureDataUrl: user.signatureData,
    displayName: user.professionalTitle || user.fullName,
    registryLine: `${user.registryType}-${user.registryState} ${user.registryNumber}`,
  }
}

export function isSignatureBlockComplete(user: {
  signatureData: string | null
  registryType: string | null
  registryNumber: string | null
  registryState: string | null
}): boolean {
  return Boolean(
    user.signatureData && user.registryType && user.registryNumber && user.registryState,
  )
}

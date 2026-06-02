import { auth } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import { db } from '@/db/client'
import { tenantUsers, tenants } from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { LogoutButton } from './logout-button'

export default async function PendingApprovalPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const [membership] = await db
    .select({ tenantName: tenants.name, status: tenants.status })
    .from(tenantUsers)
    .innerJoin(tenants, and(eq(tenants.id, tenantUsers.tenantId), isNull(tenants.deletedAt)))
    .where(and(eq(tenantUsers.userId, session.user.id), eq(tenantUsers.isActive, true)))
    .limit(1)

  if (!membership) redirect('/signup')
  if (membership.status === 'active') redirect('/dashboard')

  return (
    <>
      <img src="/brand/logo-mint.svg" alt="" className="size-16 mx-auto mb-6" />
      <h1 className="font-display text-3xl font-semibold text-charcoal">
        Flora<span className="text-sage">Clin</span>
      </h1>
      <p className="mt-2 text-lg font-medium text-charcoal">{membership.tenantName}</p>
      <div className="mt-8 rounded-lg bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <p className="text-sm text-mid leading-relaxed">
          Sua clínica está sendo analisada. Notificaremos por e-mail quando estiver tudo pronto.
        </p>
      </div>
      <LogoutButton />
    </>
  )
}

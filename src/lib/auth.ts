import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db/client'
import { tenantUsers, users, tenants } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import type { AuthContext, Role } from '@/types'

const TENANT_COOKIE = 'floraclin_tenant_id'

export async function getAuthContext(): Promise<AuthContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get ALL tenants for this user
  const memberships = await db
    .select({
      tenantId: tenantUsers.tenantId,
      role: tenantUsers.role,
      fullName: users.fullName,
      email: users.email,
      isPlatformAdmin: users.isPlatformAdmin,
    })
    .from(tenantUsers)
    .innerJoin(users, eq(users.id, tenantUsers.userId))
    .where(
      and(
        eq(tenantUsers.userId, user.id),
        eq(tenantUsers.isActive, true)
      )
    )

  const isPlatformAdmin = !!memberships[0]?.isPlatformAdmin

  if (memberships.length === 0 && !isPlatformAdmin) {
    redirect('/login')
  }

  // Resolve active tenant: cookie → first membership (or any tenant for platform admins)
  const cookieStore = await cookies()
  const selectedTenantId = cookieStore.get(TENANT_COOKIE)?.value

  let activeMembership = memberships.find(m => m.tenantId === selectedTenantId)

  if (!activeMembership && isPlatformAdmin && selectedTenantId) {
    // Platform admin can access any tenant — verify it exists
    const [tenant] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, selectedTenantId))
      .limit(1)

    if (tenant) {
      activeMembership = {
        tenantId: tenant.id,
        role: 'owner',
        fullName: memberships[0]?.fullName ?? user.email ?? '',
        email: memberships[0]?.email ?? user.email ?? '',
        isPlatformAdmin: true,
      }
    }
  }

  activeMembership = activeMembership ?? memberships[0]

  if (!activeMembership) {
    redirect('/login')
  }

  return {
    userId: user.id,
    tenantId: activeMembership.tenantId,
    role: activeMembership.role as Role,
    email: activeMembership.email,
    fullName: activeMembership.fullName,
    isPlatformAdmin,
  }
}

// Call this when user switches tenant (e.g., from tenant switcher in sidebar)
export async function setActiveTenant(tenantId: string) {
  const cookieStore = await cookies()
  cookieStore.set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  })
}

// Get all tenants for current user (for tenant switcher UI)
export async function getUserTenants(userId: string) {
  return db
    .select({
      tenantId: tenantUsers.tenantId,
      role: tenantUsers.role,
      tenantName: tenants.name,
    })
    .from(tenantUsers)
    .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
    .where(
      and(
        eq(tenantUsers.userId, userId),
        eq(tenantUsers.isActive, true)
      )
    )
}

export async function requireRole(...allowedRoles: Role[]): Promise<AuthContext> {
  const context = await getAuthContext()

  if (!allowedRoles.includes(context.role)) {
    throw new Error('Forbidden: insufficient permissions')
  }

  return context
}

export async function requirePlatformAdmin(): Promise<AuthContext> {
  const context = await getAuthContext()
  if (!context.isPlatformAdmin) {
    throw new Error('Forbidden: not platform admin')
  }
  return context
}

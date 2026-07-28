import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import Resend from 'next-auth/providers/resend'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import type { Adapter } from 'next-auth/adapters'
import { db } from '@/db/client'
import { users, sessions, accounts, verificationTokens, tenantUsers, tenants, tenantSubscriptions, plans } from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import bcrypt from 'bcryptjs'

// The FloraClin schema uses custom column names (fullName instead of name,
// avatarUrl instead of image) which causes type mismatches with the default
// DrizzleAdapter types. The runtime behavior is correct since Drizzle maps
// the snake_case DB columns. Cast via unknown to satisfy the type checker.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adapter = DrizzleAdapter(db as any, {
  usersTable: users as any,
  sessionsTable: sessions as any,
  accountsTable: accounts as any,
  verificationTokensTable: verificationTokens as any,
} as any) as Adapter

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter,
  // Credentials provider requires JWT strategy in Auth.js v5.
  // Database strategy throws UnsupportedStrategy error with Credentials.
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: {
        email: { type: 'email' },
        password: { type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email as string
        const password = credentials?.password as string
        if (!email || !password) return null

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase()))
          .limit(1)

        if (!user || !user.passwordHash) return null

        const valid = await bcrypt.compare(password, user.passwordHash)
        if (!valid) return null

        return { id: user.id, email: user.email, name: user.fullName }
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true, // Safe: signIn callback verifies email_verified
    }),
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM ?? 'FloraClin <contato@floraclin.com.br>',
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      // For Google OAuth, only allow sign-in if Google has verified the email
      if (account?.provider === 'google' && !(profile as any)?.email_verified) {
        return false
      }
      return true
    },
    async jwt({ token, user, trigger }) {
      if (user) {
        token.sub = user.id
      }

      token.v = 2

      if (user || trigger === 'update') {
        const userId = token.sub
        if (userId) {
          const [membership] = await db
            .select({
              tenantId: tenantUsers.tenantId,
              role: tenantUsers.role,
              tenantStatus: tenants.status,
              isPlatformAdmin: users.isPlatformAdmin,
            })
            .from(tenantUsers)
            .innerJoin(tenants, and(eq(tenants.id, tenantUsers.tenantId), isNull(tenants.deletedAt)))
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .where(
              and(
                eq(tenantUsers.userId, userId),
                eq(tenantUsers.isActive, true)
              )
            )
            .limit(1)

          if (!membership) {
            const [userRow] = await db
              .select({ isPlatformAdmin: users.isPlatformAdmin })
              .from(users)
              .where(eq(users.id, userId))
              .limit(1)

            token.tenantId = null
            token.tenantStatus = null
            token.role = null
            token.isPlatformAdmin = userRow?.isPlatformAdmin ?? false
            token.subscriptionStatus = 'expired'
            token.planSlug = 'free'
            token.planFeatures = {}
          } else {
            token.tenantId = membership.tenantId
            token.tenantStatus = membership.tenantStatus
            token.role = membership.role
            token.isPlatformAdmin = membership.isPlatformAdmin

            let [sub] = await db
              .select({
                status: tenantSubscriptions.status,
                planSlug: plans.slug,
                planFeatures: plans.features,
              })
              .from(tenantSubscriptions)
              .innerJoin(plans, eq(tenantSubscriptions.planId, plans.id))
              .where(eq(tenantSubscriptions.tenantId, membership.tenantId))
              .limit(1)

            // Self-heal: the API gates fail closed on a missing subscription
            // row, so a tenant whose signup-time createSubscription failed
            // would be locked out. Grant the standard trial on sign-in
            // (createSubscription is idempotent).
            if (!sub) {
              try {
                const [freePlan] = await db
                  .select({ id: plans.id, slug: plans.slug, features: plans.features })
                  .from(plans)
                  .where(eq(plans.slug, 'free'))
                  .limit(1)
                if (freePlan) {
                  const { createSubscription } = await import('@/db/queries/subscriptions')
                  const created = await createSubscription(membership.tenantId, freePlan.id)
                  if (created) {
                    sub = { status: created.status, planSlug: freePlan.slug, planFeatures: freePlan.features }
                  }
                }
              } catch (err) {
                console.error('Subscription self-heal failed:', err)
              }
            }

            token.subscriptionStatus = sub?.status ?? 'expired'
            token.planSlug = sub?.planSlug ?? 'free'
            token.planFeatures = sub?.planFeatures ?? {}
          }
        }
      }

      return token
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub
      }
      ;(session as any).tenantId = token.tenantId ?? null
      ;(session as any).tenantStatus = token.tenantStatus ?? null
      ;(session as any).role = token.role ?? null
      ;(session as any).isPlatformAdmin = token.isPlatformAdmin ?? false
      ;(session as any).subscriptionStatus = token.subscriptionStatus ?? 'expired'
      ;(session as any).planSlug = token.planSlug ?? 'free'
      ;(session as any).planFeatures = token.planFeatures ?? {}
      ;(session as any).v = token.v ?? 0
      return session
    },
  },
})

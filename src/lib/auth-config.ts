import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import Resend from 'next-auth/providers/resend'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import type { Adapter } from 'next-auth/adapters'
import { db } from '@/db/client'
import { users, sessions, accounts, verificationTokens } from '@/db/schema'
import { eq } from 'drizzle-orm'
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
    async jwt({ token, user }) {
      // On initial sign-in, persist the user id into the JWT
      if (user) {
        token.sub = user.id
      }
      return token
    },
    async session({ session, token }) {
      // Expose user id from JWT to the session object
      if (session.user && token.sub) {
        session.user.id = token.sub
      }
      return session
    },
  },
})

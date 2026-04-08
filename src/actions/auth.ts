'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
})

export type LoginState = {
  error?: { general?: string[]; email?: string[]; password?: string[] }
} | null

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    return { error: { general: ['E-mail ou senha incorretos'] } }
  }

  redirect('/dashboard')
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export type ResetPasswordState = {
  error?: string
  success?: boolean
} | null

export async function switchTenantAction(tenantId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Usuário não autenticado')
  }

  // Verify the user has an active membership in the requested tenant
  const { db } = await import('@/db/client')
  const { tenantUsers } = await import('@/db/schema')
  const { eq, and } = await import('drizzle-orm')

  const [membership] = await db
    .select({ id: tenantUsers.id })
    .from(tenantUsers)
    .where(
      and(
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.userId, user.id),
        eq(tenantUsers.isActive, true)
      )
    )
    .limit(1)

  if (!membership) {
    throw new Error('Acesso negado: você não é membro desta clínica')
  }

  const { setActiveTenant } = await import('@/lib/auth')
  await setActiveTenant(tenantId)
}

export async function resetPassword(_prevState: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const email = formData.get('email') as string

  if (!email) {
    return { error: 'E-mail é obrigatório' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')}/reset-password`,
  })

  if (error) {
    return { error: 'Erro ao enviar e-mail de recuperação' }
  }

  return { success: true }
}

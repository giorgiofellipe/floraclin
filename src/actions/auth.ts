'use server'

import { signIn, signOut } from '@/lib/auth-config'
import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'

export type LoginState = {
  error?: { email?: string[]; password?: string[]; general?: string[] }
} | null

export type ResetPasswordState = {
  error?: string
  success?: boolean
} | null

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email) return { error: { email: ['E-mail é obrigatório'] } }
  if (!password) return { error: { password: ['Senha é obrigatória'] } }

  try {
    await signIn('credentials', {
      email,
      password,
      redirectTo: '/dashboard',
    })
    return null
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: { general: ['E-mail ou senha inválidos'] } }
    }
    throw error // Re-throw non-auth errors (like redirect)
  }
}

export async function resetPassword(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const email = formData.get('email') as string

  if (!email) return { error: 'E-mail é obrigatório' }

  try {
    await signIn('resend', {
      email,
      redirectTo: '/dashboard',
      redirect: false,
    })
    return { success: true }
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: 'Erro ao enviar link de acesso' }
    }
    throw error
  }
}

export async function logout() {
  await signOut({ redirectTo: '/login' })
}

export async function loginWithGoogle() {
  await signIn('google', { redirectTo: '/dashboard' })
}

export async function loginWithMagicLink(formData: FormData) {
  const email = formData.get('magicLinkEmail') as string
  if (!email) return
  await signIn('resend', { email, redirectTo: '/dashboard' })
}

export async function switchTenantAction(tenantId: string) {
  const { setActiveTenant } = await import('@/lib/auth')
  await setActiveTenant(tenantId)
  redirect('/dashboard')
}

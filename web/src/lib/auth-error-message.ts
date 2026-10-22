/**
 * Auth.js sends failed sign-ins back to /login with `?error=<type>`. Without a
 * message the person just sees the login form again and cannot tell a
 * cancelled Google consent from a broken one.
 */
const MESSAGES: Record<string, string> = {
  OAuthCallbackError: 'O login com Google não foi concluído. Tente de novo ou entre com e-mail e senha.',
  AccessDenied: 'Não foi possível entrar com essa conta Google. Use uma conta com e-mail verificado ou entre com e-mail e senha.',
  OAuthAccountNotLinked: 'Este e-mail já tem uma conta na FloraClin. Entre com e-mail e senha.',
  Verification: 'Este link de acesso expirou ou já foi usado. Peça um novo.',
}

const FALLBACK = 'Não foi possível entrar agora. Tente de novo em instantes ou entre com e-mail e senha.'

export function authErrorMessage(error: string | undefined): string | null {
  if (!error) return null
  // CredentialsSignin is shown by the form itself, next to the fields.
  if (error === 'CredentialsSignin') return null
  return MESSAGES[error] ?? FALLBACK
}

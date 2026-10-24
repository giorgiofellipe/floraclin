import { cookies, headers } from 'next/headers'
import { LoginForm } from './login-form'
import { CALLBACK_URL_PARAM, safeCallbackPath } from '@/lib/callback-url'
import { detectInAppBrowser } from '@/lib/in-app-browser'
import { authErrorMessage } from '@/lib/auth-error-message'
import { loginFailureFromAuthError } from '@/lib/analytics/events'
import { LAST_LOGIN_METHOD_COOKIE, parseLastLoginOption } from '@/lib/last-login-method'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const userAgent = (await headers()).get('user-agent')
  const lastLoginCookie = (await cookies()).get(LAST_LOGIN_METHOD_COOKIE)?.value
  return (
    <LoginForm
      inAppBrowser={detectInAppBrowser(userAgent)}
      callbackUrl={safeCallbackPath(first(params[CALLBACK_URL_PARAM]))}
      authError={authErrorMessage(first(params.error))}
      authFailure={loginFailureFromAuthError(first(params.error))}
      lastLogin={parseLastLoginOption(lastLoginCookie)}
    />
  )
}

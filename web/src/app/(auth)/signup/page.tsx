import { cookies, headers } from 'next/headers'
import { SignUpForm } from './signup-form'
import { detectInAppBrowser } from '@/lib/in-app-browser'
import { FIRST_TOUCH_COOKIE, parseFirstTouch } from '@/lib/first-touch'
import { utmProperties } from '@/lib/analytics/events'

export default async function SignUpPage() {
  const userAgent = (await headers()).get('user-agent')
  // The first-touch cookie is httpOnly, so the UTMs reach signup_started from here.
  const firstTouch = parseFirstTouch((await cookies()).get(FIRST_TOUCH_COOKIE)?.value)
  return <SignUpForm inAppBrowser={detectInAppBrowser(userAgent)} utm={utmProperties(firstTouch)} />
}

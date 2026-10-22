import { headers } from 'next/headers'
import { SignUpForm } from './signup-form'
import { detectInAppBrowser } from '@/lib/in-app-browser'

export default async function SignUpPage() {
  const userAgent = (await headers()).get('user-agent')
  return <SignUpForm inAppBrowser={detectInAppBrowser(userAgent)} />
}

import type { Metadata, Viewport } from 'next'
import { Cormorant_Garamond, Jost } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { Toaster } from '@/components/ui/sonner'
import { QueryProvider } from '@/components/providers/query-provider'
import { CookieConsentBanner } from '@/components/marketing/cookie-consent-banner'
import { MetaPixel } from '@/components/marketing/meta-pixel'
import { metaPixelId } from '@/lib/marketing-attribution'
import './globals.css'
import { SessionProvider } from 'next-auth/react'
import { Suspense } from 'react'

const jost = Jost({ subsets: ['latin'], variable: '--font-sans' })
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-display',
})

export const viewport: Viewport = {
  themeColor: '#1C2B1E',
  // Lets pages draw under the notch / home indicator so env(safe-area-inset-*)
  // reports real values. Every edge-anchored element pads itself with those
  // insets (see globals.css body and the fixed/sticky bars); they are 0 on
  // devices without insets, so nothing moves there.
  viewportFit: 'cover',
  // interactiveWidget is set only for the inbox, see (platform)/whatsapp/layout.tsx.
}

export const metadata: Metadata = {
  title: 'FloraClin',
  description: 'Sistema para clínicas de Harmonização Orofacial',
  applicationName: 'FloraClin',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'FloraClin',
  },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()
  const pixelId = metaPixelId()

  return (
    <html lang={locale}>
      <body className={`${jost.variable} ${cormorant.variable} font-sans antialiased`}>
        <Suspense fallback={null}>
          <MetaPixel pixelId={pixelId} />
        </Suspense>
        {/* useSession() throws without this ancestor. Two client components
            need it: the billing page calls update() after a Stripe return so
            the JWT picks up the new subscription, and the confirmation screen
            does the same after verifying an email. Both are exactly the
            moments a crash would be most damaging. */}
        <SessionProvider>
          <NextIntlClientProvider messages={messages}>
            <QueryProvider>
              {children}
              <Toaster richColors position="top-right" />
            </QueryProvider>
          </NextIntlClientProvider>
        </SessionProvider>
        <CookieConsentBanner />
      </body>
    </html>
  )
}

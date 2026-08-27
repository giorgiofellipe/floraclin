import type { Metadata } from 'next'
import { Cormorant_Garamond, Jost } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { Toaster } from '@/components/ui/sonner'
import { QueryProvider } from '@/components/providers/query-provider'
import './globals.css'
import { SessionProvider } from 'next-auth/react'

const jost = Jost({ subsets: ['latin'], variable: '--font-sans' })
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-display',
})

export const metadata: Metadata = {
  title: 'FloraClin',
  description: 'Sistema para clínicas de Harmonização Orofacial',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale}>
      <body className={`${jost.variable} ${cormorant.variable} font-sans antialiased`}>
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
      </body>
    </html>
  )
}

import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { withSentryConfig } from '@sentry/nextjs'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().slice(0, 16).replace('T', ' '),
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/**',
      },
    ],
  },
}

export default withSentryConfig(withNextIntl(nextConfig), {
  org: 'bullcode',
  project: 'floraclin',
  // Auth token from env — needed only for source map uploads at build time.
  // Set SENTRY_AUTH_TOKEN in CI. Local dev skips upload when absent.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  // Route browser requests through a rewrite to bypass ad-blockers.
  tunnelRoute: '/monitoring',
})

import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { withSentryConfig } from '@sentry/nextjs'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.2.99'],
  env: {
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().slice(0, 16).replace('T', ' '),
    // Inlined from the server-side `VERCEL_ENV` at build time so the browser
    // SDK gets the right environment name without depending on Vercel's
    // "Automatically expose System Environment Variables" toggle. With the
    // toggle off, `NEXT_PUBLIC_VERCEL_ENV` is undefined in the client bundle
    // and every preview error would tag itself `production`, straight into the
    // Discord alert rule.
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.VERCEL_ENV ?? 'development',
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

const baseConfig = withNextIntl(nextConfig)

export default process.env.NODE_ENV === 'production'
  ? withSentryConfig(baseConfig, {
      org: 'bullcode',
      project: 'floraclin',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      widenClientFileUpload: true,
      sourcemaps: {
        disable: !process.env.SENTRY_AUTH_TOKEN,
      },
      tunnelRoute: '/monitoring',
    })
  : baseConfig

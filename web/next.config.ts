import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { withSentryConfig } from '@sentry/nextjs'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.2.99'],
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

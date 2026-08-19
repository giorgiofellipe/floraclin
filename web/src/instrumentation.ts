import * as Sentry from '@sentry/nextjs'

const isProd = process.env.NODE_ENV === 'production'

// `environment` is set explicitly in both inits below. The SDK's default is
// `vercel-production` / `vercel-preview` (it prefixes `VERCEL_ENV`), while the
// Discord alert rule documented in docs/runbooks/observability.md filters on
// `production`. That mismatch means the rule matches nothing.
export async function register() {
  if (!isProd) return

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: 'https://4adec01428adac2dfeca3023606b49b6@o4505070711799808.ingest.us.sentry.io/4511119159197696',
      environment: process.env.VERCEL_ENV ?? 'production',
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      debug: false,
    })
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn: 'https://4adec01428adac2dfeca3023606b49b6@o4505070711799808.ingest.us.sentry.io/4511119159197696',
      environment: process.env.VERCEL_ENV ?? 'production',
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      debug: false,
    })
  }
}

export const onRequestError = isProd ? Sentry.captureRequestError : undefined

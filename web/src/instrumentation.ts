import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '@/lib/observability'

const isProd = process.env.NODE_ENV === 'production'

// `environment` is set explicitly in both inits below. The SDK's default is
// `vercel-production` / `vercel-preview` (it prefixes `VERCEL_ENV`), while the
// Discord alert rule documented in docs/runbooks/observability.md filters on
// `production`. That mismatch means the rule matches nothing.
//
// The fallback is `development`, matching `next.config.ts`. `VERCEL_ENV` is
// always set on Vercel, so it only applies to a self-hosted or local
// production build, which must not be able to fire the production rule.
export async function register() {
  if (!isProd) return

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: 'https://4adec01428adac2dfeca3023606b49b6@o4505070711799808.ingest.us.sentry.io/4511119159197696',
      environment: process.env.VERCEL_ENV ?? 'development',
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      // The request URL is attached to server events independently of our
      // route tag, so it needs the same masking. See scrubEvent.
      beforeSend: scrubEvent,
      debug: false,
    })
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn: 'https://4adec01428adac2dfeca3023606b49b6@o4505070711799808.ingest.us.sentry.io/4511119159197696',
      environment: process.env.VERCEL_ENV ?? 'development',
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      // The request URL is attached to server events independently of our
      // route tag, so it needs the same masking. See scrubEvent.
      beforeSend: scrubEvent,
      debug: false,
    })
  }
}

export const onRequestError = isProd ? Sentry.captureRequestError : undefined

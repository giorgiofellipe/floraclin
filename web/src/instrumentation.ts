import * as Sentry from '@sentry/nextjs'

const isProd = process.env.NODE_ENV === 'production'

export async function register() {
  if (!isProd) return

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: 'https://4adec01428adac2dfeca3023606b49b6@o4505070711799808.ingest.us.sentry.io/4511119159197696',
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      debug: false,
    })
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn: 'https://4adec01428adac2dfeca3023606b49b6@o4505070711799808.ingest.us.sentry.io/4511119159197696',
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      debug: false,
    })
  }
}

export const onRequestError = isProd ? Sentry.captureRequestError : undefined

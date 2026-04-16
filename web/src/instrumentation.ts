import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: 'https://4adec01428adac2dfeca3023606b49b6@o4505070711799808.ingest.us.sentry.io/4511119159197696',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      sendDefaultPii: false,
      debug: false,
    })
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn: 'https://4adec01428adac2dfeca3023606b49b6@o4505070711799808.ingest.us.sentry.io/4511119159197696',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      sendDefaultPii: false,
      debug: false,
    })
  }
}

export const onRequestError = Sentry.captureRequestError

import * as Sentry from '@sentry/nextjs'

const isProd = process.env.NODE_ENV === 'production'

if (isProd) {
  Sentry.init({
    dsn: 'https://4adec01428adac2dfeca3023606b49b6@o4505070711799808.ingest.us.sentry.io/4511119159197696',
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    sendDefaultPii: false,
    debug: false,
  })
}

export const onRouterTransitionStart = isProd ? Sentry.captureRouterTransitionStart : undefined

import type { CaptureResult, PostHog, PostHogConfig } from 'posthog-js'
import { analyticsConfig } from './config'
import { clearPostHogStorage } from './consent'
import { CLIENT_EVENT_NAMES, pickEventProperties, type AnalyticsEventProperties, type ClientEventName } from './events'
import { sanitizeEventProperties, sanitizeUrl } from './sanitize'

/**
 * Browser analytics. Two modes, switched by the cookie banner's optional
 * ("marketing") consent, see `analyticsConsentGranted`:
 *
 * - Without consent (the default): cookieless. Memory persistence, so the
 *   anonymous id lives only until the next full page load and nothing is written to
 *   cookies, localStorage or sessionStorage. No autocapture, pageviews, replay
 *   or heatmaps; `beforeSend` lets through only the funnel events in
 *   `CLIENT_EVENT_NAMES` plus `$identify`/`$groupidentify`, which carry ids
 *   and nothing else. Legal basis: legitimate interest (LGPD art. 7º IX).
 * - With consent: normal persistence, autocapture, pageviews, session replay
 *   and heatmaps, all with text and attributes masked (see `CONSENTED_CONFIG`).
 *
 * With no `NEXT_PUBLIC_POSTHOG_KEY` nothing here does anything, and
 * posthog-js is never even downloaded: it is imported dynamically on init.
 */

let instance: Promise<PostHog | null> | null = null
let consentGranted = false
// Set on pages that must not be tracked at all (platform admins' sessions).
let suppressed = false

const CONSENTLESS_EVENTS = new Set<string>([...CLIENT_EVENT_NAMES, '$identify', '$groupidentify'])

// Attributes replay needs to render the layout. Everything else (href, title,
// aria-label, alt, data-*, value) can carry a patient's name, phone or id.
const REPLAY_KEPT_ATTRIBUTES = new Set(['class', 'style', 'id', 'type', 'role', 'width', 'height', 'colspan', 'rowspan', 'dir'])

function maskReplayAttribute(name: string, value: string, element?: Element): string {
  if (REPLAY_KEPT_ATTRIBUTES.has(name)) return value
  // Stylesheet links: static assets, and the replay needs them for styling.
  if (name === 'href' && element?.tagName === 'LINK') return value
  return '*'
}

// Platform pages show patient names, clinical notes and patient photos.
// Replay records the DOM, so all of that is masked or blocked; layout, clicks
// and navigation are what replay is for here. Hidden inputs are recorded
// unmasked by rrweb whatever `maskAllInputs` says. Network headers and bodies
// (API responses carry patient data) are off explicitly: only an explicit
// `false` here overrides the project's remote replay settings.
const SESSION_RECORDING: PostHogConfig['session_recording'] = {
  maskAllInputs: true,
  maskTextSelector: '*',
  maskAttributeFn: maskReplayAttribute,
  blockSelector: 'img, video, canvas, picture, input[type=hidden]',
  recordHeaders: false,
  recordBody: false,
}

const COOKIELESS_CONFIG = {
  persistence: 'memory',
  autocapture: false,
  rageclick: false,
  capture_pageview: false,
  capture_pageleave: false,
  enable_heatmaps: false,
  capture_heatmaps: false,
} as const satisfies Partial<PostHogConfig>

const CONSENTED_CONFIG = {
  persistence: 'localStorage+cookie',
  autocapture: true,
  rageclick: true,
  capture_pageview: 'history_change',
  capture_pageleave: 'if_capture_pageview',
  enable_heatmaps: true,
  capture_heatmaps: true,
} as const satisfies Partial<PostHogConfig>

/** `before_send`: drops anything but funnel events without consent, and scrubs URLs on everything. */
function beforeSend(event: CaptureResult | null): CaptureResult | null {
  if (!event || suppressed) return null
  if (!consentGranted && !CONSENTLESS_EVENTS.has(event.event)) return null
  event.properties = sanitizeEventProperties(event.properties ?? {})
  if (event.$set) event.$set = sanitizeEventProperties(event.$set)
  if (event.$set_once) event.$set_once = sanitizeEventProperties(event.$set_once)
  if (event.event === '$snapshot') {
    event.properties.$snapshot_data = sanitizeSnapshotHrefs(event.properties.$snapshot_data)
  }
  if (event.event === '$$heatmap') {
    event.properties.$heatmap_data = sanitizeHeatmapUrls(event.properties.$heatmap_data)
  }
  return event
}

// Heatmap points are keyed by the raw `location.href`.
function sanitizeHeatmapUrls(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data
  const out: Record<string, unknown[]> = {}
  for (const [url, points] of Object.entries(data)) {
    const key = sanitizeUrl(url)
    out[key] = [...(out[key] ?? []), ...(Array.isArray(points) ? points : [])]
  }
  return out
}

// rrweb meta events (type 4) carry the raw `location.href`, query string included.
const RRWEB_META_EVENT = 4

function sanitizeSnapshotHrefs(snapshots: unknown): unknown {
  if (!Array.isArray(snapshots)) return snapshots
  return snapshots.map((snapshot) =>
    snapshot?.type === RRWEB_META_EVENT && typeof snapshot.data?.href === 'string'
      ? { ...snapshot, data: { ...snapshot.data, href: sanitizeUrl(snapshot.data.href) } }
      : snapshot,
  )
}

function buildInitConfig(host: string, granted: boolean): Partial<PostHogConfig> {
  return {
    api_host: host,
    ...(granted ? CONSENTED_CONFIG : COOKIELESS_CONFIG),
    // Started explicitly once consent is known.
    disable_session_recording: true,
    session_recording: SESSION_RECORDING,
    // Explicit, so the project's remote setting cannot turn it on.
    enable_recording_console_log: false,
    // The Logs product turns console capture on from the project's remote
    // settings regardless of local config; dropping every record is what holds.
    logs: { beforeSend: () => null },
    // Both feed the stored initial person info: the raw first URL and referrer,
    // sent with every /flags request (bypassing before_send) and kept in the cookie.
    save_referrer: false,
    save_campaign_params: false,
    cross_subdomain_cookie: false,
    capture_dead_clicks: false,
    capture_performance: false,
    // Sentry already owns error tracking.
    capture_exceptions: false,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    person_profiles: 'identified_only',
    // Autocapture: no element text, no attribute values (hrefs carry ids).
    mask_all_text: true,
    mask_all_element_attributes: true,
    mask_personal_data_properties: true,
    before_send: beforeSend,
  }
}

/**
 * Loads and initialises posthog-js once, in the mode the current consent
 * allows; later calls only re-apply consent. Resolves to null when analytics
 * is not configured.
 */
export function initAnalytics(options: { consentGranted: boolean }): Promise<PostHog | null> {
  if (instance) {
    void applyAnalyticsConsent(options.consentGranted)
    return instance
  }
  const config = typeof window === 'undefined' ? null : analyticsConfig()
  if (!config) return Promise.resolve(null)

  consentGranted = options.consentGranted
  // Leftovers from an earlier consent that has since been withdrawn (in
  // another tab, or on the marketing site, which shares the banner cookie).
  if (!consentGranted) clearPostHogStorage()

  instance = import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(config.key, buildInitConfig(config.host, consentGranted))
      if (consentGranted) posthog.startSessionRecording()
      return posthog
    })
    .catch(() => null)
  return instance
}

/**
 * Stops all capture (and replay) on this tab until a tracked page mounts the
 * provider again. For sessions that started on /login and continue as a
 * platform admin, without reloading.
 */
export function setAnalyticsSuppressed(value: boolean): void {
  suppressed = value
  if (value) {
    void instance?.then((posthog) => posthog?.stopSessionRecording())
  } else if (consentGranted) {
    void instance?.then((posthog) => posthog?.startSessionRecording())
  }
}

/** Switches between cookieless and consented mode. */
export async function applyAnalyticsConsent(granted: boolean): Promise<void> {
  if (granted === consentGranted) return
  consentGranted = granted
  const posthog = await instance
  if (!posthog) return

  if (granted) {
    // A grant that arrived while posthog-js was loading has already been
    // applied by init, which captured the initial pageview itself.
    const initialisedConsented = posthog.config.persistence !== 'memory'
    posthog.set_config(CONSENTED_CONFIG)
    if (!suppressed) posthog.startSessionRecording()
    // history_change only fires on the next navigation.
    if (!initialisedConsented) posthog.capture('$pageview')
  } else {
    posthog.stopSessionRecording()
    posthog.set_config(COOKIELESS_CONFIG)
    clearPostHogStorage()
  }
}

// The provider is an earlier sibling of every caller, so its effect has
// already started PostHog; no instance means this page is not tracked.
export function track<E extends ClientEventName>(event: E, properties: AnalyticsEventProperties[E]): void {
  if (!instance) return
  const picked = pickEventProperties(event, properties)
  void instance.then((posthog) => {
    posthog?.capture(event, picked)
  })
}

/** By internal ids only: no person properties, no group properties. */
export function identifyAnalyticsUser(userId: string, tenantId: string | null): void {
  void instance?.then((posthog) => {
    if (!posthog) return
    if (posthog.get_distinct_id() !== userId) {
      // Another account signed in on this tab without a logout in between.
      if (isIdentified(posthog)) posthog.reset()
      posthog.identify(userId)
    }
    if (tenantId) posthog.group('tenant', tenantId)
  })
}

/** On logout. Also run where only signed-out pages render, for sessions that ended without one. */
export function resetAnalytics(options: { onlyIfIdentified?: boolean } = {}): void {
  void instance?.then((posthog) => {
    if (!posthog) return
    if (options.onlyIfIdentified && !isIdentified(posthog)) return
    posthog.reset()
  })
}

function isIdentified(posthog: PostHog): boolean {
  return posthog.get_property('$user_state') === 'identified'
}

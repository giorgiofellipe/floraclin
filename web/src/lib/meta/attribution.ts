export interface ReferralCapture {
  ctwaClid?: string
  adId?: string
  adHeadline?: string
  sourceUrl?: string
  sourceType?: string
}

interface WhatsappMessageReferral {
  source_url?: string
  source_id?: string
  source_type?: string
  headline?: string
  body?: string
  media_type?: string
  image_url?: string
  video_url?: string
  thumbnail_url?: string
  ctwa_clid?: string
}

/**
 * The `referral` object is present only on the first inbound message of an
 * ad-originated conversation; every later message in the same conversation
 * omits it. A `source_id` with no `ctwa_clid` is an organic post click, not
 * an ad click, and is still worth storing.
 */
export function parseReferral(referral: unknown): ReferralCapture | null {
  if (!referral || typeof referral !== 'object') return null

  const r = referral as WhatsappMessageReferral
  const capture: ReferralCapture = {}
  if (r.ctwa_clid) capture.ctwaClid = r.ctwa_clid
  if (r.source_id) capture.adId = r.source_id
  if (r.headline) capture.adHeadline = r.headline
  if (r.source_url) capture.sourceUrl = r.source_url
  if (r.source_type) capture.sourceType = r.source_type

  return Object.keys(capture).length > 0 ? capture : null
}

/**
 * Meta's own fbc cookie format: fb.<subdomain-index>.<creation time in ms>.<fbclid>.
 * `1` is the fixed subdomain-index for a first-party cookie on the top
 * domain, not a version number.
 */
export function buildFbc(fbclid: string, clickedAt: Date = new Date()): string {
  return `fb.1.${clickedAt.getTime()}.${fbclid}`
}

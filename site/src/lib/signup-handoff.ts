// The site and the app each record the first touch in the floraclin_ft cookie
// on .floraclin.com.br, but that cookie only exists if the site's response was
// actually served to this browser. Meta's in-app browser preloads ad landing
// pages, and Google refuses OAuth inside it, so people often finish signup in
// another cookie jar (or with a page the server never saw). Carrying the
// campaign params on the signup link itself lets the app capture them on its
// own /signup request whatever happened to the site's cookie.

const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
// Ad click ids identify a click, so like the cookie they stop travelling once marketing is refused.
const CLICK_ID_PARAMS = ['fbclid', 'gclid'] as const
const MAX_PARAM_LENGTH = 200
export const LANDING_PARAMS_STORAGE_KEY = 'floraclin_landing_params'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/** The campaign params of a query string, UTMs first, click ids only when asked for. */
export function campaignParams(search: string, includeClickIds: boolean): URLSearchParams {
  const source = new URLSearchParams(search)
  const picked = new URLSearchParams()
  const names = includeClickIds ? [...UTM_PARAMS, ...CLICK_ID_PARAMS] : UTM_PARAMS
  for (const name of names) {
    const value = source.get(name)?.trim()
    if (value) picked.set(name, value.slice(0, MAX_PARAM_LENGTH))
  }
  return picked
}

/**
 * Keeps the landing page's UTMs for this tab, so a visitor who browses to
 * /precos before clicking still carries them. Like the cookie, the first visit
 * that brought a campaign wins. Click ids are never stored here: the visitor
 * may still refuse, so they only travel straight from the current URL.
 */
export function rememberLandingParams(search: string, storage: StorageLike | null): void {
  if (!storage) return
  const incoming = campaignParams(search, false)
  if (!incoming.size) return
  try {
    if (storage.getItem(LANDING_PARAMS_STORAGE_KEY)) return
    storage.setItem(LANDING_PARAMS_STORAGE_KEY, incoming.toString())
  } catch {
    // Storage can be blocked in in-app browsers; the current URL still works.
  }
}

/** The signup URL with the visit's campaign params, falling back to the bare URL. */
export function signupUrlWithCampaign(
  signupUrl: string,
  { search, storage, includeClickIds }: { search: string; storage: StorageLike | null; includeClickIds: boolean },
): string {
  const params = campaignParams(search, includeClickIds)
  // A later page can carry only a click id; the landing page's UTMs still apply.
  if (storage && !UTM_PARAMS.some((name) => params.has(name))) {
    try {
      campaignParams(storage.getItem(LANDING_PARAMS_STORAGE_KEY) ?? '', false).forEach((value, name) =>
        params.set(name, value),
      )
    } catch {
      // Ignore blocked storage.
    }
  }
  if (!params.size) return signupUrl
  const url = new URL(signupUrl)
  params.forEach((value, name) => url.searchParams.set(name, value))
  return url.toString()
}

export function sessionStorageOrNull(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

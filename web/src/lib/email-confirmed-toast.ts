/**
 * Query parameter the e-mail confirmation sign-in adds to where it lands, so
 * that page says "E-mail confirmado." once. It only triggers that toast, and
 * the page drops it from the URL right after, so a reload or Back does not
 * toast again.
 */
export const EMAIL_CONFIRMED_PARAM = 'email_confirmed'

export function wantsEmailConfirmedToast(value: string | string[] | undefined): boolean {
  return value === '1'
}

/** `path` with the parameter added, for redirects that must carry it along. */
export function withEmailConfirmedParam(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}${EMAIL_CONFIRMED_PARAM}=1`
}

/** The current URL (path, query and hash) without the parameter. */
export function withoutEmailConfirmedParam(url: URL): string {
  const params = new URLSearchParams(url.search)
  params.delete(EMAIL_CONFIRMED_PARAM)
  const query = params.toString()
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`
}

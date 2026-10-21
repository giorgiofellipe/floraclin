/**
 * IndexNow (https://www.indexnow.org) lets us tell Bing, Yandex and the other
 * participating engines that pages changed, instead of waiting for a crawl.
 *
 * The key comes from INDEXNOW_KEY on the floraclin-site Vercel project. It is
 * public by design: it is served at /{key}.txt so the engines can check that
 * whoever pings owns the host. When the variable is unset or malformed,
 * IndexNow is off: no key file is served and the ping script does nothing.
 */
const KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;

export function indexNowKey(raw: string | undefined = process.env.INDEXNOW_KEY): string | null {
  const key = raw?.trim();
  return key && KEY_PATTERN.test(key) ? key : null;
}

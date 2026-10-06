export const COOKIE_CONSENT_STORAGE_KEY = "floraclin_cookie_consent_v1";
export const COOKIE_CONSENT_COOKIE_NAME = "floraclin_cookie_consent";
export const COOKIE_CONSENT_CHANGE_EVENT = "floraclin-cookie-consent-change";
const COOKIE_CONSENT_TTL_DAYS = 180;

export interface CookieConsentChoice {
  necessary: true;
  marketing: boolean;
  updatedAt: string;
  version: 1;
}

export type CookieConsentStatus = "unset" | "granted" | "denied";

export function cookieConsentStatus(): CookieConsentStatus {
  const choice = readCookieConsent();
  if (!choice) return "unset";
  return choice.marketing ? "granted" : "denied";
}

export function subscribeCookieConsent(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  function handleStorage(event: StorageEvent) {
    if (event.key === COOKIE_CONSENT_STORAGE_KEY) {
      onStoreChange();
    }
  }

  window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(COOKIE_CONSENT_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function readCookieConsent(): CookieConsentChoice | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY) ?? readCookie(COOKIE_CONSENT_COOKIE_NAME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CookieConsentChoice>;
    if (parsed.version !== 1 || typeof parsed.marketing !== "boolean") return null;
    return {
      necessary: true,
      marketing: parsed.marketing,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      version: 1,
    };
  } catch {
    return null;
  }
}

export function hasMarketingConsent(): boolean {
  return readCookieConsent()?.marketing === true;
}

export function saveCookieConsent(marketing: boolean): CookieConsentChoice {
  const choice: CookieConsentChoice = {
    necessary: true,
    marketing,
    updatedAt: new Date().toISOString(),
    version: 1,
  };

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(choice));
    } catch {
      // If storage is blocked, keep the runtime default: no optional marketing cookies.
    }

    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    const domain = cookieDomain(window.location.hostname);
    document.cookie = `${COOKIE_CONSENT_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(choice))}; Max-Age=${COOKIE_CONSENT_TTL_DAYS * 24 * 60 * 60}; Path=/; SameSite=Lax${secure}${domain}`;

    const fbq = window.fbq as ((command: string, value: string) => void) | undefined;
    fbq?.("consent", marketing ? "grant" : "revoke");
    window.dispatchEvent(new CustomEvent<CookieConsentChoice>(COOKIE_CONSENT_CHANGE_EVENT, { detail: choice }));
  }

  return choice;
}

export function openCookiePreferences(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("floraclin-open-cookie-preferences"));
}

function readCookie(name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function cookieDomain(hostname: string): string {
  if (hostname === "floraclin.com.br" || hostname.endsWith(".floraclin.com.br")) {
    return "; Domain=.floraclin.com.br";
  }
  return "";
}

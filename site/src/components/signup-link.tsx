"use client";

import { useEffect, useSyncExternalStore, type ComponentProps, type MouseEvent } from "react";
import { hasMarketingConsent, subscribeCookieConsent } from "@/lib/cookie-consent";
import { SIGNUP_URL } from "@/lib/marketing-attribution";
import { rememberLandingParams, sessionStorageOrNull, signupUrlWithCampaign } from "@/lib/signup-handoff";

function currentSignupUrl(): string {
  return signupUrlWithCampaign(SIGNUP_URL, {
    search: window.location.search,
    storage: sessionStorageOrNull(),
    marketingConsent: hasMarketingConsent(),
  });
}

/**
 * Links to the app's signup, carrying the visit's UTMs (and, with marketing
 * consent, the ad click id) so the app records the campaign even when the
 * site's first-touch cookie never reached this browser.
 */
export function SignupLink({ onClick, ...props }: Omit<ComponentProps<"a">, "href">) {
  // Server render and hydration use the bare URL; the client then re-reads it
  // and again whenever the cookie banner changes consent.
  const href = useSyncExternalStore(subscribeCookieConsent, currentSignupUrl, () => SIGNUP_URL);

  useEffect(() => {
    rememberLandingParams(window.location.search, sessionStorageOrNull());
  }, []);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // Safety net for consent changed in another tab (the storage event can
    // lag): the browser reads the href only after this handler returns.
    event.currentTarget.href = currentSignupUrl();
    onClick?.(event);
  }

  return <a {...props} href={href} onClick={handleClick} />;
}

"use client";

import { useEffect, useSyncExternalStore, type ComponentProps, type MouseEvent } from "react";
import { SIGNUP_URL } from "@/lib/marketing-attribution";
import { rememberLandingParams, sessionStorageOrNull, signupUrlWithCampaign } from "@/lib/signup-handoff";

function subscribeNever(): () => void {
  return () => {};
}

function currentSignupUrl(): string {
  return signupUrlWithCampaign(SIGNUP_URL, {
    search: window.location.search,
    storage: sessionStorageOrNull(),
  });
}

/**
 * Links to the app's signup, carrying the visit's UTMs and ad click id so the
 * app records the campaign even when the site's first-touch cookie never
 * reached this browser.
 */
export function SignupLink({ onClick, ...props }: Omit<ComponentProps<"a">, "href">) {
  // Server render and hydration use the bare URL; the client then reads the real one.
  const href = useSyncExternalStore(subscribeNever, currentSignupUrl, () => SIGNUP_URL);

  useEffect(() => {
    rememberLandingParams(window.location.search, sessionStorageOrNull());
  }, []);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // The landing params can be remembered after the first render; the browser
    // reads the href only after this handler returns.
    event.currentTarget.href = currentSignupUrl();
    onClick?.(event);
  }

  return <a {...props} href={href} onClick={handleClick} />;
}

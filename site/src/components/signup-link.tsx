"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import { subscribeCookieConsent } from "@/lib/cookie-consent";
import { SIGNUP_URL, signupUrlWithPendingAttribution } from "@/lib/marketing-attribution";

export function SignupLink(props: Omit<ComponentProps<"a">, "href">) {
  const href = useSyncExternalStore(subscribeCookieConsent, signupUrlWithPendingAttribution, () => SIGNUP_URL);
  return <a {...props} href={href} />;
}

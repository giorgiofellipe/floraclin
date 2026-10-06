"use client";

import { useEffect } from "react";
import { COOKIE_CONSENT_CHANGE_EVENT, hasMarketingConsent, type CookieConsentChoice } from "@/lib/cookie-consent";
import { captureFirstTouchAttribution } from "@/lib/marketing-attribution";

export function AttributionCapture() {
  useEffect(() => {
    if (hasMarketingConsent()) {
      captureFirstTouchAttribution();
    }

    function handleConsentChange(event: Event) {
      const next = (event as CustomEvent<CookieConsentChoice>).detail;
      if (next?.marketing) {
        captureFirstTouchAttribution();
      }
    }

    window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, handleConsentChange);
    return () => window.removeEventListener(COOKIE_CONSENT_CHANGE_EVENT, handleConsentChange);
  }, []);

  return null;
}

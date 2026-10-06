'use client'

import Script from 'next/script'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { cookieConsentStatus, subscribeCookieConsent } from '@/lib/cookie-consent'
import { DEFAULT_META_PIXEL_ID, trackMetaEvent } from '@/lib/marketing-attribution'

interface MetaPixelProps {
  pixelId?: string
}

export function MetaPixel({ pixelId = DEFAULT_META_PIXEL_ID }: MetaPixelProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const trackedInitialPageView = useRef(false)
  const consentStatus = useSyncExternalStore(subscribeCookieConsent, cookieConsentStatus, () => 'unset')
  const canUseMarketing = consentStatus === 'granted'

  useEffect(() => {
    if (!canUseMarketing) return
    if (!trackedInitialPageView.current) {
      trackedInitialPageView.current = true
      return
    }
    trackMetaEvent('PageView')
  }, [canUseMarketing, pathname, searchParams])

  if (!pixelId || !canUseMarketing) return null

  return (
    <>
      <Script id="floraclin-meta-pixel" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('consent', 'grant');
          fbq('init', '${pixelId}');
          fbq('track', 'PageView');
        `}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: 'none' }}
          src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  )
}

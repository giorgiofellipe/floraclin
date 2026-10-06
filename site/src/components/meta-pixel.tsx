"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { DEFAULT_META_PIXEL_ID, trackMetaEvent } from "@/lib/marketing-attribution";

export function MetaPixel({ pixelId = DEFAULT_META_PIXEL_ID }: { pixelId?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const trackedInitialPageView = useRef(false);

  useEffect(() => {
    if (!trackedInitialPageView.current) {
      trackedInitialPageView.current = true;
      return;
    }
    trackMetaEvent("PageView");
  }, [pathname, searchParams]);

  if (!pixelId) return null;

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
          fbq('init', '${pixelId}');
          fbq('track', 'PageView');
        `}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}

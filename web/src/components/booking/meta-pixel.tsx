'use client'

import Script from 'next/script'

interface MetaPixelProps {
  datasetId: string | null
}

/**
 * Standard Meta Pixel snippet, PageView only. Lead is emitted server-side
 * in the booking route with a deterministic event_id; firing it here too
 * would double-count since there is no dedup coordination with the browser.
 */
export function MetaPixel({ datasetId }: MetaPixelProps) {
  // The booking page is public and unauthenticated, and this id is inlined
  // into a script tag, so anything but a Meta numeric id is refused.
  if (!datasetId || !/^\d+$/.test(datasetId)) return null

  return (
    <Script id="meta-pixel" strategy="afterInteractive">
      {`
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', ${JSON.stringify(datasetId)});
        fbq('track', 'PageView');
      `}
    </Script>
  )
}

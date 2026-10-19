import type { Viewport } from 'next'

// Android Chrome shrinks the layout viewport (and dvh) when the keyboard opens,
// so the full-height inbox keeps its composer above it. Scoped to this segment
// because app-wide it lifts fixed bottom bars (wizard nav, form submit) over the
// field being typed in and reflows vh-sized pages.
//
// Next merges this with the root viewport (viewport-fit=cover etc. stay) and,
// on client-side navigation, renders the target route's viewport in the RSC
// head, so the <meta name="viewport"> gains the key on soft navigation into
// /whatsapp and loses it on the way out, history back/forward included. Checked
// against next@16.2.3 in Chrome; no client-side meta patching needed.
export const viewport: Viewport = {
  interactiveWidget: 'resizes-content',
}

export default function WhatsAppLayout({ children }: { children: React.ReactNode }) {
  return children
}

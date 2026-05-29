import { getAuthContext } from '@/lib/auth'

/**
 * Layout for printable pages — receitas, atestados and procedure
 * summaries that the user actually puts on paper. Authenticated like
 * `(platform)` but renders no sidebar/header/chrome so the document
 * fills the page without competing with FloraClin UI in print preview.
 */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  // Same auth gate as (platform). Print pages handle PHI so they must
  // never be reachable without a session.
  await getAuthContext()
  return <>{children}</>
}

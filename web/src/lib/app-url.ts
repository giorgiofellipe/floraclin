/**
 * Resolves this app's own public base URL, for building absolute links or
 * asset URLs from server code that has no request object with a real Host
 * header to read from (PDF rendering, emails, background jobs).
 *
 * Prefers `NEXT_PUBLIC_APP_URL` (set explicitly in every real environment);
 * falls back to Vercel's own `VERCEL_URL` (set automatically on every
 * deployment, including previews); falls back to localhost for local dev
 * when neither is set.
 *
 * This is the house pattern already used by
 * `@/app/api/patients/[id]/anamnesis-link/route.ts` and
 * `@/app/api/profile/reset-request/route.ts`, extracted here so every other
 * call site shares one fallback chain instead of drifting. Before this
 * helper existed, `prontuario-pdf.tsx` fell back to the production origin
 * while `pdf.ts` fell back to `''` for the same variable: on a preview
 * deploy with `NEXT_PUBLIC_APP_URL` unset, diagram images loaded from
 * production while the verification link on the same document broke.
 */
export function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  )
}

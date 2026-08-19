/**
 * The tenant projection `<ClinicHeader>` (`@/components/print/clinic-header`)
 * needs: name, contact details, logo and address.
 *
 * This lives in `@/lib` rather than next to the query that produces it
 * (`getTenantHeaderInfo`, `@/db/queries/tenants`) because
 * `issue-document-dialog` is a client component and needs the same
 * placeholder below. Importing it from the query module would pull
 * `@/db/client` (and `postgres`) into the browser bundle.
 */
export interface TenantHeaderInfo {
  name: string
  phone: string | null
  email: string | null
  /**
   * A signed, short-lived Supabase Storage URL, or a base64 `data:` URI when
   * the header is bound for a PDF. `tenants.logo_url` itself holds a bare
   * storage path; see `signLogoPath` / `fetchLogoDataUri` in `@/lib/logo`.
   */
  logoUrl: string | null
  /**
   * The raw JSONB `tenants.address` shape. Narrow it with
   * `toClinicHeaderAddress` before handing it to `<ClinicHeader>`.
   */
  address: Record<string, unknown> | null
}

/**
 * Header used when there is no tenant row to read: the document still renders,
 * with an empty clinic block, instead of failing outright. Every report PDF
 * route and the document preview fall back to this.
 */
export const EMPTY_TENANT_HEADER = {
  name: '',
  phone: null,
  email: null,
  logoUrl: null,
  address: null,
} as const satisfies TenantHeaderInfo

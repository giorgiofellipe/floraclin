/**
 * The clinic a user with several memberships is working in. Only a hint:
 * getAuthContext ignores it unless it names a live membership (or the user is
 * a platform admin), so a stale value is harmless there, but it should not
 * outlive the membership it pointed at.
 */
export const TENANT_COOKIE = 'floraclin_tenant_id'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export const TENANT_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: ONE_YEAR_SECONDS,
}

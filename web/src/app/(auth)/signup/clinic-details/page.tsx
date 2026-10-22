import { auth } from '@/lib/auth-config'
import { getClinicMemberships } from '@/db/queries/clinic-membership'
import { ClinicDetailsForm } from './clinic-details-form'

/**
 * Middleware sends every signed-in token without a tenant here. That is not
 * always a brand-new user: the token can be behind a clinic that already
 * exists, or the user's only clinic can be suspended (the session never
 * resolves a soft-deleted tenant). Asking either of them for clinic details
 * again only loops, so check first.
 *
 * A brand-new account (never in any clinic) is not asked anything here: the
 * clinic is created on arrival and onboarding asks for its name and phone,
 * once. Accounts that were in a clinic before, and platform admins, still
 * get the form.
 */
export default async function ClinicDetailsPage() {
  const session = await auth()
  const memberships = session?.user?.id
    ? await getClinicMemberships(session.user.id)
    : { liveTenantIds: [], suspendedOnly: false, neverMember: false }
  const hasClinic = memberships.liveTenantIds.length > 0
  const isPlatformAdmin = (session as { isPlatformAdmin?: boolean } | null)?.isPlatformAdmin === true

  return (
    <ClinicDetailsForm
      hasClinic={hasClinic}
      suspended={memberships.suspendedOnly}
      autoStart={memberships.neverMember && !isPlatformAdmin}
    />
  )
}

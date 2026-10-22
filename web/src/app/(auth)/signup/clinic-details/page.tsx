import { auth } from '@/lib/auth-config'
import { getClinicMemberships } from '@/db/queries/clinic-membership'
import { ClinicDetailsForm } from './clinic-details-form'

/**
 * Middleware sends every signed-in token without a tenant here. That is not
 * always a brand-new user: the token can be behind a clinic that already
 * exists, or the user's only clinic can be suspended (the session never
 * resolves a soft-deleted tenant). Asking either of them for clinic details
 * again only loops, so check first.
 */
export default async function ClinicDetailsPage() {
  const session = await auth()
  const memberships = session?.user?.id
    ? await getClinicMemberships(session.user.id)
    : { liveTenantIds: [], suspended: false }
  const hasClinic = memberships.liveTenantIds.length > 0

  return <ClinicDetailsForm hasClinic={hasClinic} suspended={!hasClinic && memberships.suspended} />
}

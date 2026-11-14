// Who may create each record; mirrors the POST role checks of
// /api/appointments, /api/patients and /api/financial.
export const APPOINTMENT_CREATE_ROLES: readonly string[] = ['owner', 'practitioner', 'receptionist']
export const PATIENT_CREATE_ROLES: readonly string[] = ['owner', 'practitioner', 'receptionist']
export const CHARGE_CREATE_ROLES: readonly string[] = ['owner', 'receptionist', 'financial']

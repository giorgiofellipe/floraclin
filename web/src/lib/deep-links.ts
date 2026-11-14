// In-app URLs that open a create form on arrival. The target pages read these
// params (patient-list `novo`, agenda `open` + `patient`/`patientName`), so keep both sides in step.
export const NEW_PATIENT_PATH = '/pacientes?novo=1'
export const NEW_APPOINTMENT_PATH = '/agenda?open=new'

export function newAppointmentPathFor(patient: { id: string; fullName: string }) {
  const params = new URLSearchParams({ patient: patient.id, patientName: patient.fullName })
  return `${NEW_APPOINTMENT_PATH}&${params}`
}

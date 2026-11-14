// In-app URLs that open a create form on arrival. The target pages read these
// params (patient-list `novo`, agenda `open`, financial-list `novo`), so keep
// both sides in step.
export const NEW_PATIENT_PATH = '/pacientes?novo=1'
export const NEW_APPOINTMENT_PATH = '/agenda?open=new'
export const NEW_CHARGE_PATH = '/financeiro?novo=1'

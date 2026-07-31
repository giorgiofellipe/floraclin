export interface SeededPatient {
  id: string
  fullName: string
  cpf: string
  birthDate: string
  gender: 'feminino' | 'masculino'
  email: string
  phone: string
  referralSource: string
}

export interface PlannedProcedure {
  procedureName: string
  price: number
  /** BR calendar day, YYYY-MM-DD. */
  date: string
  startTime: string
  endTime: string
  patientIndex: number
}

export interface PlannedEntry {
  procedure: PlannedProcedure
  totalAmount: number
  installments: Array<{
    number: number
    amount: number
    dueDate: string
    status: 'paid' | 'pending'
    /** Only set when paid. */
    paidAt?: string
    paymentMethod?: string
  }>
}

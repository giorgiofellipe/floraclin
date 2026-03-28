// Phone: (XX) XXXXX-XXXX
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 2) return digits.length ? `(${digits}` : ''
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

// CPF: XXX.XXX.XXX-XX
export function maskCPF(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

// CEP: XXXXX-XXX
export function maskCEP(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 5) return digits
  return `${digits.slice(0, 5)}-${digits.slice(5)}`
}

// Currency: cents to BRL display
// Type 1 → 0,01 | Type 12 → 0,12 | Type 123 → 1,23 | Type 1234 → 12,34 | Type 12345 → 123,45
export function maskCurrency(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (!digits) return ''
  const cents = parseInt(digits, 10)
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Parse masked currency back to number (for form submission)
export function parseCurrency(masked: string): number {
  const digits = masked.replace(/\D/g, '')
  return parseInt(digits, 10) / 100
}

// Unmask to raw digits
export function unmask(value: string): string {
  return value.replace(/\D/g, '')
}

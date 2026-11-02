export function onlyDigits(v: string): string {
  return v.replace(/\D/g, '')
}

function cpfCheckDigit(digits: number[]): number {
  const weightStart = digits.length + 1
  const sum = digits.reduce((acc, d, i) => acc + d * (weightStart - i), 0)
  const remainder = sum % 11
  return remainder < 2 ? 0 : 11 - remainder
}

export function isValidCpf(v: string): boolean {
  const d = onlyDigits(v)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const nums = d.split('').map(Number)
  return cpfCheckDigit(nums.slice(0, 9)) === nums[9] && cpfCheckDigit(nums.slice(0, 10)) === nums[10]
}

export function isValidCep(v: string): boolean {
  return onlyDigits(v).length === 8
}

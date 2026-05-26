// Brazil added a 9th digit (leading 9) to mobile numbers in 2012-2016.
// WhatsApp sometimes stores the old 8-digit format (55 + DDD + 8 digits = 12)
// while patient records use the current format (55 + DDD + 9 + 8 digits = 13).
export function normalizeBrPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('55')) {
    const ddd = digits.slice(2, 4)
    const local = digits.slice(4)
    if (/^[6-9]/.test(local)) {
      return `55${ddd}9${local}`
    }
  }
  return digits
}

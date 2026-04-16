import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { parseLocalDate } from './dates'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Bare YYYY-MM-DD (DB `date` column) must be parsed at local noon — otherwise
// `new Date('2026-04-16')` is UTC midnight and displays as 15/04/2026 in BR.
function toDisplayDate(date: Date | string): Date {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return parseLocalDate(date, '12:00:00')
  }
  return new Date(date)
}

export function formatDate(date: Date | string): string {
  return format(toDisplayDate(date), 'dd/MM/yyyy', { locale: ptBR })
}

export function formatDateTime(date: Date | string): string {
  return format(toDisplayDate(date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

export function maskCPF(cpf: string): string {
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '***.$2.***-**')
}

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

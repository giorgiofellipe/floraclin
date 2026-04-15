'use client'

import type { UseFormReturn, FieldValues } from 'react-hook-form'

function getNestedError(errors: Record<string, unknown>, path: string): { message?: string } | null {
  const parts = path.split('.')
  let current: unknown = errors
  for (const part of parts) {
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[part]
  }
  if (!current || typeof current !== 'object') return null
  if ('message' in current && typeof (current as { message?: string }).message === 'string') {
    return current as { message?: string }
  }
  return null
}

interface Props<T extends FieldValues> {
  form: UseFormReturn<T>
  name: string
}

export function FormFieldError<T extends FieldValues>({ form, name }: Props<T>) {
  const error = getNestedError(form.formState.errors as Record<string, unknown>, name)
  if (!error?.message) return null
  return <p className="mt-1 text-xs text-red-600">{error.message}</p>
}

/**
 * Returns true when the given field path has a validation error.
 * Use to toggle `aria-invalid` and a red border on the corresponding input.
 *
 * Walks parent paths too — e.g. `hasFieldError(form, 'financialPlan.totalAmount')`
 * returns true both when the error is at `financialPlan.totalAmount` and when
 * it's at the higher-level `financialPlan` root (which can happen if a
 * superRefine sets an error for the whole object).
 */
export function hasFieldError<T extends FieldValues>(
  form: UseFormReturn<T>,
  name: string,
): boolean {
  const errors = form.formState.errors as Record<string, unknown>
  // Check the exact path
  if (getNestedError(errors, name)) return true
  // Also check every ancestor path (a.b.c → a.b → a)
  const parts = name.split('.')
  for (let i = parts.length - 1; i > 0; i--) {
    const parent = parts.slice(0, i).join('.')
    if (getNestedError(errors, parent)) return true
  }
  return false
}

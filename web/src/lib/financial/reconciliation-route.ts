import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { requireRole } from '@/lib/auth'
import type { requireWrite } from '@/lib/write-access'
import { handleApiError } from '@/lib/api-error'
import { BusinessError } from '@/lib/errors'
import { ACCOUNT_MANAGER_ROLES } from '@/lib/financial/account-roles'
import { decodeOfxBytes, OFX_MAX_BYTES, parseOfx, type ParsedOfx } from '@/lib/financial/ofx'
import { importFormSchema } from '@/validations/bank-reconciliation'
import type { AuthContext } from '@/types'

export type WriteGate = () => ReturnType<typeof requireWrite>

/**
 * Shared shell of the reconciliation routes. Bank statements are only for the
 * owner and the Financeiro role, on every plan (decision on #88), so reads and
 * writes both check the role on the server. Writes pass their own
 * `() => requireWrite(...ACCOUNT_MANAGER_ROLES)` gate, so each mutating route
 * file calls `requireWrite` itself, as write-access-coverage.test.ts checks.
 */
export async function reconciliationRoute(
  request: Request,
  mode: 'read' | WriteGate,
  run: (ctx: AuthContext) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    let ctx: AuthContext
    if (mode !== 'read') {
      const gate = await mode()
      if (gate.blocked) return gate.blocked
      ctx = gate.ctx
    } else {
      ctx = await requireRole(...ACCOUNT_MANAGER_ROLES)
    }
    return NextResponse.json({ success: true, data: await run(ctx) })
  } catch (error) {
    if (error instanceof BusinessError) {
      const status = error.code === 'INVALID_BODY' ? 400 : error.code === 'STATEMENT_INVALID' ? 422 : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    return handleApiError(error, request)
  }
}

/** Parses a JSON body or throws a 400-style BusinessError the shell turns into a response. */
export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new BusinessError('INVALID_BODY', 'Corpo da requisição inválido')
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new BusinessError('INVALID_BODY', parsed.error.issues[0]?.message ?? 'Dados inválidos')
  }
  return parsed.data
}

export interface OfxUpload {
  accountId: string
  fileName: string
  parsed: ParsedOfx
}

/** Reads the multipart upload (accountId + file), enforcing the size limit before decoding. */
export async function readOfxUpload(request: Request): Promise<OfxUpload> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    throw new BusinessError('INVALID_BODY', 'Envie o arquivo OFX')
  }
  const fields = importFormSchema.safeParse({ accountId: form.get('accountId') })
  if (!fields.success) throw new BusinessError('INVALID_BODY', fields.error.issues[0]?.message ?? 'Conta inválida')

  // A string field named "file" is not an upload. Checked by shape rather than
  // instanceof File, which differs between the runtimes this code is tested in.
  const file = form.get('file')
  if (!file || typeof file === 'string' || file.size === 0) throw new BusinessError('INVALID_BODY', 'Envie o arquivo OFX')
  if (file.size > OFX_MAX_BYTES) {
    throw new BusinessError('STATEMENT_INVALID', `Arquivo maior que ${OFX_MAX_BYTES / 1024 / 1024} MB`)
  }
  const parsed = parseOfx(decodeOfxBytes(new Uint8Array(await file.arrayBuffer())))
  return { accountId: fields.data.accountId, fileName: file.name || 'extrato.ofx', parsed }
}

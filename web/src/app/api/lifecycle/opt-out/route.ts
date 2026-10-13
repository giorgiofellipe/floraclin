import { NextRequest } from 'next/server'
import { z } from 'zod'
import { isValidLifecycleOptOut, optOutTenantLifecycle } from '@/lib/lifecycle-opt-out'

function page(body: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>FloraClin</title></head><body style="font-family:sans-serif;max-width:480px;margin:48px auto;padding:0 16px">${body}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

const invalid = () => page('<p>Link inválido.</p>', 400)

function parseLink(t: unknown, s: unknown): { t: string; s: string } | null {
  const tenantId = z.uuid().safeParse(t)
  if (!tenantId.success || typeof s !== 'string') return null
  return isValidLifecycleOptOut(tenantId.data, s) ? { t: tenantId.data, s } : null
}

// GET only renders the confirm form: mail scanners and link previews follow GET links.
export async function GET(request: NextRequest) {
  const link = parseLink(request.nextUrl.searchParams.get('t'), request.nextUrl.searchParams.get('s'))
  if (!link) return invalid()

  return page(
    `<p>Deseja parar de receber dicas da FloraClin?</p><form method="post"><input type="hidden" name="t" value="${link.t}"><input type="hidden" name="s" value="${link.s}"><button type="submit">Parar de receber</button></form>`,
    200,
  )
}

export async function POST(request: NextRequest) {
  const form = await request.formData()
  const link = parseLink(form.get('t'), form.get('s'))
  if (!link) return invalid()

  const updated = await optOutTenantLifecycle(link.t)
  if (!updated) return invalid()

  return page('<p>Pronto. Você não receberá mais dicas da FloraClin.</p>', 200)
}

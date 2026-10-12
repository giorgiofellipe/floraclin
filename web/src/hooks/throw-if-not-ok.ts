type ToError = (message: string, status: number, code?: string) => Error

export async function throwIfNotOk(res: Response, toError: ToError = (message) => new Error(message)) {
  if (res.ok) return
  const body = await res.json().catch(() => ({}))
  throw toError(body.error || `HTTP ${res.status}`, res.status, body.code)
}

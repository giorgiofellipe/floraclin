import { createStorageClient } from '@/lib/supabase/storage-client'

const BUCKET_NAME = 'floraclin'

export function getStoragePath(tenantId: string, patientId: string, filename: string): string {
  return `${tenantId}/patients/${patientId}/${filename}`
}

export async function uploadFile(
  path: string,
  file: File
): Promise<{ path: string; error: string | null }> {
  const supabase = createStorageClient()

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })

  if (error) {
    return { path: '', error: error.message }
  }

  return { path: data.path, error: null }
}

export async function getSignedUrl(path: string, expiresIn = 900): Promise<string | null> {
  const supabase = createStorageClient()

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, expiresIn)

  if (error) return null
  return data.signedUrl
}

export async function deleteFile(path: string): Promise<void> {
  const supabase = createStorageClient()
  await supabase.storage.from(BUCKET_NAME).remove([path])
}

/**
 * Server-side helper to upload an in-memory Buffer (e.g. a generated PDF) to
 * the floraclin bucket under `<tenantId>/patients/<patientId>/<fileName>` and
 * return both the storage path and a fetchable URL.
 *
 * `visibility: 'signed'` returns a short-lived signed URL so external services
 * like Meta/WhatsApp can fetch the file. Buckets are private by default; we
 * never expose public URLs for PHI. Default TTL is 1h — Meta downloads media
 * within seconds of the API call, so a longer-lived URL just widens the window
 * an attacker has to use a leaked URL.
 */
export async function uploadPdfBuffer(args: {
  tenantId: string
  patientId: string
  fileName: string
  buffer: Buffer
  visibility?: 'signed' | 'private'
  signedExpiresIn?: number
}): Promise<{ path: string; url: string }> {
  const supabase = createStorageClient()
  const path = getStoragePath(args.tenantId, args.patientId, args.fileName)

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, args.buffer, {
      contentType: 'application/pdf',
      cacheControl: '3600',
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`Falha ao enviar PDF: ${uploadError.message}`)
  }

  const expiresIn = args.signedExpiresIn ?? 60 * 60 // 1 hour default — Meta downloads media within seconds
  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, expiresIn)

  if (signError || !signed?.signedUrl) {
    throw new Error(
      `Falha ao gerar URL assinada: ${signError?.message ?? 'desconhecido'}`,
    )
  }

  return { path, url: signed.signedUrl }
}

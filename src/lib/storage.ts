import { createClient } from '@/lib/supabase/server'

const BUCKET_NAME = 'floraclin'

export function getStoragePath(tenantId: string, patientId: string, filename: string): string {
  return `${tenantId}/patients/${patientId}/${filename}`
}

export async function uploadFile(
  path: string,
  file: File
): Promise<{ path: string; error: string | null }> {
  const supabase = await createClient()

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
  const supabase = await createClient()

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, expiresIn)

  if (error) return null
  return data.signedUrl
}

export async function deleteFile(path: string): Promise<void> {
  const supabase = await createClient()
  await supabase.storage.from(BUCKET_NAME).remove([path])
}

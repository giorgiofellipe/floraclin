import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { addExpenseAttachment } from '@/db/queries/expenses'
import { uploadFile } from '@/lib/storage'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]

const expenseIdSchema = z.string().uuid('ID da despesa inválido')

// Magic byte signatures for allowed file types
const MAGIC_BYTES: Record<string, { bytes: number[]; offset?: number; extra?: (buf: Uint8Array) => boolean }> = {
  'image/jpeg': { bytes: [0xFF, 0xD8, 0xFF] },
  'image/png': { bytes: [0x89, 0x50, 0x4E, 0x47] },
  'application/pdf': { bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  'image/webp': {
    bytes: [0x52, 0x49, 0x46, 0x46], // RIFF
    extra: (buf) => buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50, // WEBP
  },
}

function verifyMagicBytes(buffer: Uint8Array, claimedMime: string): boolean {
  const sig = MAGIC_BYTES[claimedMime]
  if (!sig) return false
  const offset = sig.offset ?? 0
  if (buffer.length < offset + sig.bytes.length) return false
  for (let i = 0; i < sig.bytes.length; i++) {
    if (buffer[offset + i] !== sig.bytes[i]) return false
  }
  if (sig.extra && !sig.extra(buffer)) return false
  return true
}

function getExpenseStoragePath(tenantId: string, expenseId: string, filename: string): string {
  return `${tenantId}/expenses/${expenseId}/${filename}`
}

export async function POST(request: Request) {
  try {
    const ctx = await getAuthContext()
    if (!['owner', 'financial'].includes(ctx.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const expenseId = formData.get('expenseId') as string | null

    if (!file || !expenseId) {
      return NextResponse.json(
        { error: 'Arquivo e ID da despesa são obrigatórios' },
        { status: 400 }
      )
    }

    // Validate expenseId is a proper UUID
    const uuidResult = expenseIdSchema.safeParse(expenseId)
    if (!uuidResult.success) {
      return NextResponse.json(
        { error: 'ID da despesa inválido' },
        { status: 400 }
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Arquivo excede o tamanho máximo de 10MB' },
        { status: 400 }
      )
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Tipo de arquivo não permitido. Use JPEG, PNG, WebP ou PDF.' },
        { status: 400 }
      )
    }

    // Verify file magic bytes match claimed MIME type to prevent spoofing
    const fileBuffer = new Uint8Array(await file.arrayBuffer())
    if (!verifyMagicBytes(fileBuffer, file.type)) {
      return NextResponse.json(
        { error: 'O conteúdo do arquivo não corresponde ao tipo declarado.' },
        { status: 400 }
      )
    }

    // Generate unique filename
    const timestamp = Date.now()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = getExpenseStoragePath(ctx.tenantId, expenseId, `${timestamp}_${safeName}`)

    const { path, error: uploadError } = await uploadFile(storagePath, file)
    if (uploadError) {
      return NextResponse.json(
        { error: `Erro ao fazer upload: ${uploadError}` },
        { status: 500 }
      )
    }

    const attachment = await addExpenseAttachment(
      ctx.tenantId,
      expenseId,
      {
        fileName: file.name,
        fileUrl: path,
        fileSize: file.size,
        mimeType: file.type,
      },
      ctx.userId
    )

    return NextResponse.json({ success: true, data: attachment })
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('Forbidden')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg.includes('NEXT_REDIRECT') || msg.includes('redirect')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (msg.includes('not found') || msg.includes('does not belong')) {
      return NextResponse.json({ error: 'Despesa não encontrada' }, { status: 404 })
    }
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

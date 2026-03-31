'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  useUploadExpenseAttachment,
  useDeleteExpenseAttachment,
} from '@/hooks/mutations/use-expense-mutations'
import { UploadIcon, FileIcon, TrashIcon, DownloadIcon, Loader2Icon } from 'lucide-react'

interface Attachment {
  id: string
  fileName: string
  fileSize: number
  url: string
}

interface ExpenseAttachmentUploadProps {
  expenseId: string
  attachments: Attachment[]
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ACCEPTED_TYPES = 'image/*,application/pdf'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ExpenseAttachmentUpload({ expenseId, attachments }: ExpenseAttachmentUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Attachment | null>(null)

  const uploadMutation = useUploadExpenseAttachment()
  const deleteMutation = useDeleteExpenseAttachment()

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setError(null)

    if (file.size > MAX_FILE_SIZE) {
      setError('Arquivo deve ter no maximo 10MB')
      return
    }

    try {
      await uploadMutation.mutateAsync({ expenseId, file })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar arquivo')
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync({ id: deleteTarget.id, expenseId })
      setDeleteTarget(null)
    } catch {
      // error handled by mutation
    }
  }

  return (
    <div className="space-y-3">
      {/* Existing attachments */}
      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center justify-between rounded-[3px] border border-[#E8ECEF] bg-[#F9FAFB] px-3 py-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileIcon className="size-4 text-sage shrink-0" />
                <span className="text-sm text-charcoal truncate">{att.fileName}</span>
                <span className="text-xs text-mid shrink-0">{formatFileSize(att.fileSize)}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  asChild
                >
                  <a href={att.url} target="_blank" rel="noopener noreferrer" title="Download">
                    <DownloadIcon className="size-3.5 text-sage" />
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setDeleteTarget(att)}
                  title="Excluir"
                >
                  <TrashIcon className="size-3.5 text-red-500" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          className="hidden"
          onChange={handleFileChange}
          data-testid="expense-file-input"
        />
        <Button
          variant="outline"
          size="sm"
          className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
        >
          {uploadMutation.isPending ? (
            <>
              <Loader2Icon className="size-3.5 animate-spin" data-icon="inline-start" />
              Enviando...
            </>
          ) : (
            <>
              <UploadIcon data-icon="inline-start" />
              Anexar arquivo
            </>
          )}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-[#2A2A2A]">Excluir Anexo</DialogTitle>
            <DialogDescription className="text-mid">
              Tem certeza que deseja excluir o arquivo &quot;{deleteTarget?.fileName}&quot;?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2">
            <Button variant="outline" className="border-sage/30 text-charcoal hover:bg-[#F0F7F1] transition-colors" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Excluindo...' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCommitStatementImport, usePreviewStatementImport } from '@/hooks/queries/use-bank-reconciliation'

const brDate = (ymd: string | null) => (ymd ? ymd.split('-').reverse().join('/') : '—')

/** Shows what an OFX file would do before anything is saved, then imports it on confirmation. */
export function ImportDialog({
  accountId,
  file,
  onClose,
}: {
  accountId: string
  file: File | null
  onClose: () => void
}) {
  const preview = usePreviewStatementImport()
  const commit = useCommitStatementImport()
  const { mutate: runPreview, reset: resetPreview } = preview

  useEffect(() => {
    if (file) runPreview({ accountId, file })
    else resetPreview()
  }, [file, accountId, runPreview, resetPreview])

  async function handleImport() {
    if (!file) return
    try {
      const result = await commit.mutateAsync({ accountId, file })
      toast.success(
        result.alreadyImported
          ? 'Este extrato já tinha sido importado'
          : `${result.newLines} lançamento(s) importado(s)${result.duplicateLines ? `, ${result.duplicateLines} já existiam` : ''}`,
      )
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao importar o extrato')
    }
  }

  const data = preview.data
  return (
    <Dialog open={Boolean(file)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar extrato</DialogTitle>
          <DialogDescription>{file?.name}</DialogDescription>
        </DialogHeader>

        {preview.isPending && (
          <div className="flex items-center gap-2 py-6 text-sm text-mid">
            <Loader2Icon className="h-4 w-4 animate-spin" /> Lendo o arquivo...
          </div>
        )}

        {preview.error && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
            {preview.error instanceof Error ? preview.error.message : 'Arquivo inválido'}
          </p>
        )}

        {data && (
          <div className="space-y-3 text-sm" data-testid="import-preview">
            <p>
              Período: {brDate(data.periodStart)} a {brDate(data.periodEnd)}
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{data.total} lançamento(s) no arquivo</li>
              <li>{data.newLines} novo(s) serão importados</li>
              <li>{data.duplicateLines} já estão no sistema e serão ignorados</li>
            </ul>
            {data.alreadyImported && <p className="text-amber-700">Este mesmo extrato já foi importado nesta conta.</p>}
            {data.suspects.length > 0 && (
              <div className="rounded-md bg-amber-50 p-3 text-amber-800" data-testid="import-suspects">
                {data.suspects.length} lançamento(s) parecem repetir outros já importados com outro identificador do banco.
                Eles serão importados e marcados para você conferir.
              </div>
            )}
            {data.warnings.map((w) => (
              <p key={w} className="text-amber-700">{w}</p>
            ))}
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
          <Button onClick={handleImport} disabled={!data || commit.isPending || data.alreadyImported || data.newLines === 0}>
            {commit.isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
            Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangleIcon, InfoIcon, Loader2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose } from '@/components/ui/dialog'
import { useCommitStatementImport, usePreviewStatementImport } from '@/hooks/queries/use-bank-reconciliation'
import { ReconciliationDialogContent } from './reconciliation-dialog'

const brDate = (ymd: string | null) => (ymd ? ymd.split('-').reverse().join('/') : '—')

/** Preview first; an account mismatch requires a separate explicit confirmation. */
export function ImportDialog({ accountId, file, onClose }: { accountId: string; file: File | null; onClose: () => void }) {
  const preview = usePreviewStatementImport()
  const commit = useCommitStatementImport()
  const { mutate: runPreview, reset: resetPreview } = preview
  const [confirmation, setConfirmation] = useState<{ file: File; accountId: string } | null>(null)
  const confirmed = Boolean(file && confirmation?.file === file && confirmation.accountId === accountId)

  useEffect(() => {
    if (file) runPreview({ accountId, file })
    else resetPreview()
  }, [file, accountId, runPreview, resetPreview])

  const data = preview.data
  // accountWarnings on the server only reports differing OFX / selected bank account numbers.
  const differentAccount = Boolean(data?.warnings.length)
  async function handleImport() {
    if (!file || !data || preview.isPending || preview.error || commit.isPending) return
    if (differentAccount && !confirmed) { setConfirmation({ file, accountId }); return }
    try {
      const result = await commit.mutateAsync({ accountId, file })
      toast.success(result.alreadyImported ? 'Este extrato já tinha sido importado' :
        `${result.newLines} ${result.newLines === 1 ? 'lançamento importado' : 'lançamentos importados'}${result.duplicateLines ? `, ${result.duplicateLines} ${result.duplicateLines === 1 ? 'já existia' : 'já existiam'}` : ''}`)
      onClose()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro ao importar o extrato') }
  }

  return (
    <Dialog open={Boolean(file)} onOpenChange={(open) => !open && onClose()}>
      <ReconciliationDialogContent title="Importar extrato" description="Confira o arquivo, a conta e os lançamentos antes de importar.">
        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-4 [overflow-wrap:anywhere]">
          <p className="min-w-0 truncate text-xs text-[#6B6B6B]" title={file?.name}>{file?.name}</p>
          {preview.isPending && <div className="flex items-center gap-2 py-6 text-sm text-[#6B6B6B]"><Loader2Icon className="size-4 animate-spin" />Lendo o arquivo…</div>}
          {preview.error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
            <p>{preview.error instanceof Error ? preview.error.message : 'Arquivo inválido'}</p>
            <Button variant="outline" className="mt-2 min-h-11" onClick={() => file && runPreview({ accountId, file })}>Tentar de novo</Button>
          </div>}
          {data && !preview.isPending && !preview.error && <div className="min-w-0 space-y-4 text-sm" data-testid="import-preview">
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-[#F4F6F8] p-3">
              {[{ value: data.total, label: 'no arquivo' }, { value: data.newLines, label: data.newLines === 1 ? 'novo' : 'novos' }, { value: data.duplicateLines, label: data.duplicateLines === 1 ? 'repetido' : 'repetidos' }].map((item) => <div key={item.label} className="min-w-0"><strong className="block text-xl">{item.value}</strong><span className="text-xs text-[#6B6B6B]">{item.label}</span></div>)}
            </div>
            <p className="text-[#6B6B6B]">{brDate(data.periodStart)} a {brDate(data.periodEnd)}</p>
            {data.warnings.map((warning) => <div key={warning} role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
              <p className="flex items-center gap-2 font-medium"><AlertTriangleIcon className="size-4 shrink-0" />Conta diferente</p><p className="mt-1 text-xs">{warning}</p>
            </div>)}
            {data.alreadyImported && <p className="flex items-start gap-2 rounded-xl bg-[#F4F6F8] p-3"><InfoIcon className="size-4 shrink-0" />Este mesmo extrato já foi importado nesta conta.</p>}
            {data.suspects.length > 0 && <div className="rounded-xl bg-amber-50 p-3 text-amber-900" data-testid="import-suspects">
              <p className="flex items-center gap-2 font-medium"><AlertTriangleIcon className="size-4 shrink-0" />{data.suspects.length} {data.suspects.length === 1 ? 'possível duplicado' : 'possíveis duplicados'}</p>
              <p className="mt-1 text-xs">Mesmo dia e valor. Serão importados e marcados para conferir.</p>
              <details><summary className="flex min-h-11 cursor-pointer items-center text-xs">Ver detalhes</summary><p className="text-xs">O identificador do banco ou a descrição difere de outro lançamento já importado.</p></details>
            </div>}
          </div>}
        </div>
        <div className="shrink-0 space-y-2 border-t bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {confirmed && differentAccount && <p role="alert" className="text-sm text-amber-900">Confirma a importação na conta selecionada, mesmo com o número diferente?</p>}
          <Button className="min-h-11 w-full" onClick={handleImport} disabled={!data || preview.isPending || Boolean(preview.error) || commit.isPending || data.alreadyImported || data.newLines === 0}>
            {commit.isPending && <Loader2Icon className="size-4 animate-spin" />}{differentAccount ? confirmed ? 'Confirmar importação' : 'Importar mesmo assim' : 'Importar'}
          </Button>
          <DialogClose render={<Button variant="outline" className="min-h-11 w-full" disabled={commit.isPending} />}>Cancelar</DialogClose>
        </div>
      </ReconciliationDialogContent>
    </Dialog>
  )
}

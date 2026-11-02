'use client'

import { useState } from 'react'
import { differenceInCalendarDays, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertTriangleIcon, KeyRoundIcon, Loader2Icon, ShieldCheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useDeleteNfseCertificate,
  useNfseCertificate,
  useSaveNfseCertificate,
} from '@/hooks/queries/use-nfse-settings'

const MAX_PFX_BYTES = 48 * 1024
const EXPIRY_WARNING_DAYS = 30

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function formatCnpj(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

export function CertificateCard() {
  const { data: certificate, isLoading } = useNfseCertificate()
  const save = useSaveNfseCertificate()
  const remove = useDeleteNfseCertificate()

  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const showForm = !certificate || isFormOpen

  async function handleUpload() {
    if (!file || !password) return
    if (file.size > MAX_PFX_BYTES) {
      toast.error('Certificado grande demais')
      return
    }
    try {
      await save.mutateAsync({ pfxBase64: await fileToBase64(file), password })
      toast.success('Certificado salvo')
      setFile(null)
      setPassword('')
      setIsFormOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar o certificado')
    }
  }

  async function handleRemove() {
    try {
      await remove.mutateAsync()
      toast.success('Certificado removido')
      setConfirmOpen(false)
      setIsFormOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover o certificado')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2Icon className="h-5 w-5 animate-spin text-[#4A6B52]" />
      </div>
    )
  }

  const daysLeft = certificate
    ? differenceInCalendarDays(new Date(certificate.validTo), new Date())
    : null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="uppercase tracking-wider text-xs font-medium text-mid">
          Certificado digital
        </h3>
        <div className="flex-1 h-px bg-[#E8ECEF]" />
      </div>

      {certificate && (
        <div className="space-y-2 rounded-lg border border-[#E8ECEF] p-4 text-sm">
          <div className="flex items-center gap-2">
            <KeyRoundIcon className="h-4 w-4 text-[#4A6B52]" />
            <span className="font-medium text-charcoal">
              {certificate.subject.split(':')[0]}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-mid">CNPJ</span>
            <span className="text-charcoal">{formatCnpj(certificate.cnpj)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-mid">Válido até</span>
            <span className="text-charcoal">
              {format(new Date(certificate.validTo), "dd 'de' MMM 'de' yyyy", { locale: ptBR })}
            </span>
          </div>
          {daysLeft !== null && daysLeft <= EXPIRY_WARNING_DAYS && (
            <div
              className={`flex items-center gap-1.5 text-xs ${daysLeft < 0 ? 'text-red-600' : 'text-amber-700'}`}
            >
              <AlertTriangleIcon className="h-3.5 w-3.5" />
              {daysLeft < 0 ? 'Vencido' : `Vence em ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'}`}
            </div>
          )}
          {!showForm && (
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsFormOpen(true)}>
                Substituir
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
                Remover
              </Button>
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="nfse-pfx">Arquivo do certificado (.pfx ou .p12)</Label>
            <Input
              id="nfse-pfx"
              type="file"
              accept=".pfx,.p12,application/x-pkcs12"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nfse-pfx-password">Senha do certificado</Label>
            <Input
              id="nfse-pfx-password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-mid">
            <ShieldCheckIcon className="h-3.5 w-3.5 text-[#4A6B52]" />
            O certificado e a senha ficam criptografados e nunca são exibidos de novo.
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={handleUpload} disabled={!file || !password || save.isPending}>
              {save.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Salvar certificado'}
            </Button>
            {certificate && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsFormOpen(false)
                  setFile(null)
                  setPassword('')
                }}
              >
                Cancelar
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover certificado</DialogTitle>
            <DialogDescription>
              Tem certeza? As configurações de nota fiscal serão removidas e nenhuma NFS-e poderá ser emitida até enviar um novo certificado.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button variant="destructive" onClick={handleRemove} disabled={remove.isPending}>
              {remove.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Remover'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

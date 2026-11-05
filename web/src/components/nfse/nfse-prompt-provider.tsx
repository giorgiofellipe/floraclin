'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { useSubscriptionAccess } from '@/components/layout/subscription-access'
import { EmitNfseDialog } from '@/components/nfse/emit-nfse-dialog'
import type { NfseIntake } from '@/types'

interface NfsePrompt {
  promptAfterPayment: (nfse: NfseIntake | null | undefined) => void
  openEmit: (paymentRecordIds: string[]) => void
  openNotConfigured: () => void
}

const NfsePromptContext = createContext<NfsePrompt | null>(null)

export function useNfsePrompt(): NfsePrompt {
  const prompt = useContext(NfsePromptContext)
  if (!prompt) throw new Error('useNfsePrompt must be used inside NfsePromptProvider')
  return prompt
}

/** Lives in the platform layout so the emit dialog outlives the screen that
 *  took the payment (a filter can hide the paid entry, a form can close). */
export function NfsePromptProvider({ children }: { children: ReactNode }) {
  const { role } = useSubscriptionAccess()
  const [emitIds, setEmitIds] = useState<string[] | null>(null)
  const [notConfiguredOpen, setNotConfiguredOpen] = useState(false)

  const openEmit = useCallback((paymentRecordIds: string[]) => setEmitIds(paymentRecordIds), [])
  const promptAfterPayment = useCallback((nfse: NfseIntake | null | undefined) => {
    if (nfse && nfse.promptPaymentRecordIds.length > 0) setEmitIds(nfse.promptPaymentRecordIds)
  }, [])
  const openNotConfigured = useCallback(() => setNotConfiguredOpen(true), [])

  const value = useMemo(
    () => ({ promptAfterPayment, openEmit, openNotConfigured }),
    [promptAfterPayment, openEmit, openNotConfigured],
  )

  return (
    <NfsePromptContext.Provider value={value}>
      {children}
      {emitIds && (
        <EmitNfseDialog
          paymentRecordIds={emitIds}
          open
          onOpenChange={(open) => {
            if (!open) setEmitIds(null)
          }}
        />
      )}
      <Dialog open={notConfiguredOpen} onOpenChange={setNotConfiguredOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>NFS-e não configurada</DialogTitle>
            <DialogDescription>Configure a emissão de nota fiscal para emitir NFS-e dos pagamentos.</DialogDescription>
          </DialogHeader>
          {role !== 'owner' && (
            <p className="text-sm text-mid">
              Peça à pessoa responsável pela clínica para configurar a NFS-e em Configurações › Nota fiscal.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotConfiguredOpen(false)}>
              Fechar
            </Button>
            {role === 'owner' && (
              <Link
                href="/configuracoes?tab=nota-fiscal"
                className={buttonVariants()}
                onClick={() => setNotConfiguredOpen(false)}
              >
                Configurar NFS-e
              </Link>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </NfsePromptContext.Provider>
  )
}

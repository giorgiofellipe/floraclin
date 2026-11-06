'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoPopover } from '@/components/ui/info-popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { ChargeActionDialogs, type ChargeDialog } from './charge-action-dialogs'
import { CheckCircleIcon, XCircleIcon, RefreshCwIcon, Undo2Icon, ChevronUpIcon } from 'lucide-react'

interface BulkActionBarProps {
  selectedCount: number
  selectedInstallmentIds: string[]
  selectedEntryIds: string[]
  canRenegotiate?: boolean
  canUncancel?: boolean
  onClear: () => void
  onRenegotiate: () => void
  onSuccess?: () => void
}

const RENEGOTIATE_REASON = 'Selecione cobranças do mesmo paciente'

export function BulkActionBar({
  selectedCount,
  selectedInstallmentIds,
  selectedEntryIds,
  canRenegotiate = true,
  canUncancel = false,
  onClear,
  onRenegotiate,
  onSuccess,
}: BulkActionBarProps) {
  const [dialog, setDialog] = useState<ChargeDialog | null>(null)

  if (selectedCount === 0) return null

  const renegotiateReason = !canRenegotiate && selectedEntryIds.length > 0 ? RENEGOTIATE_REASON : null

  return (
    <>
      <div
        data-testid="bulk-action-bar"
        className={cn(
          // Insets keep it clear of the notch / home indicator (viewport-fit=cover).
          'fixed bottom-0 left-[env(safe-area-inset-left)] right-[env(safe-area-inset-right)] z-40 ml-0 md:ml-64',
          'border-t border-sage/20 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.08)]',
          // Phones stack the count over the actions so they never overflow at 375px.
          'flex flex-col gap-2 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
          'sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6',
          'animate-in slide-in-from-bottom duration-200',
        )}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-charcoal">
            {selectedCount} {selectedCount === 1 ? 'selecionado' : 'selecionados'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-mid hover:text-charcoal"
            onClick={onClear}
          >
            Limpar
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-11 flex-1 bg-forest text-cream hover:bg-sage transition-colors sm:h-7 sm:flex-none"
            onClick={() => setDialog('pay')}
            disabled={selectedInstallmentIds.length === 0}
          >
            <CheckCircleIcon data-icon="inline-start" />
            Marcar como pago ({selectedInstallmentIds.length})
          </Button>

          {/* Phones: the other actions sit behind "Mais". */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  className="h-11 border-sage/30 px-4 text-charcoal sm:hidden"
                  data-testid="bulk-more"
                >
                  Mais
                  <ChevronUpIcon data-icon="inline-end" />
                </Button>
              }
            />
            <DropdownMenuContent side="top" align="end" className="w-64">
              <DropdownMenuItem
                variant="destructive"
                className="min-h-11"
                disabled={selectedEntryIds.length === 0}
                onClick={() => setDialog('cancel')}
              >
                <XCircleIcon />
                Cancelar ({selectedEntryIds.length})
              </DropdownMenuItem>
              <DropdownMenuItem
                className="min-h-11 flex-wrap"
                disabled={!canRenegotiate}
                onClick={onRenegotiate}
              >
                <RefreshCwIcon />
                Renegociar ({selectedEntryIds.length})
                {renegotiateReason && <span className="basis-full pl-5.5 text-xs text-mid">{renegotiateReason}</span>}
              </DropdownMenuItem>
              {canUncancel && (
                <DropdownMenuItem className="min-h-11" onClick={() => setDialog('uncancel')}>
                  <Undo2Icon />
                  Reativar ({selectedEntryIds.length})
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            size="sm"
            variant="destructive"
            className="hidden sm:inline-flex"
            onClick={() => setDialog('cancel')}
            disabled={selectedEntryIds.length === 0}
          >
            <XCircleIcon data-icon="inline-start" />
            Cancelar ({selectedEntryIds.length})
          </Button>
          <InfoPopover content={renegotiateReason} className="hidden sm:inline-flex">
            <Button
              size="sm"
              variant="outline"
              className="hidden border-sage/30 text-charcoal hover:bg-confirmed-bg transition-colors sm:inline-flex"
              onClick={onRenegotiate}
              disabled={!canRenegotiate}
            >
              <RefreshCwIcon data-icon="inline-start" />
              Renegociar ({selectedEntryIds.length})
            </Button>
          </InfoPopover>
          {canUncancel && (
            <Button
              size="sm"
              variant="outline"
              className="hidden border-sage/30 text-charcoal hover:bg-confirmed-bg transition-colors sm:inline-flex"
              onClick={() => setDialog('uncancel')}
            >
              <Undo2Icon data-icon="inline-start" />
              Reativar ({selectedEntryIds.length})
            </Button>
          )}
        </div>
      </div>

      <ChargeActionDialogs
        dialog={dialog}
        onDialogChange={setDialog}
        installmentIds={selectedInstallmentIds}
        entryIds={selectedEntryIds}
        onSuccess={() => {
          onClear()
          onSuccess?.()
        }}
      />
    </>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SearchIcon, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  CommandDialog,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { usePatientSearch } from '@/hooks/queries/use-patients'
import { useDebounced } from '@/hooks/use-debounced'
import { formatBrPhone } from '@/lib/phone'

export function PatientSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query, 250)
  const { data: results, isFetching } = usePatientSearch(debounced, { enabled: open })
  const ready = debounced.trim().length >= 2
  const hint = !ready ? 'Digite pelo menos 2 caracteres.' : isFetching && !results ? 'Buscando...' : null

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.repeat) {
        e.preventDefault()
        setOpen((o) => !o)
        setQuery('')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setQuery('')
  }

  const goTo = (id: string) => {
    handleOpenChange(false)
    router.push(`/pacientes/${id}`)
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-11 md:hidden"
        aria-label="Buscar paciente"
        onClick={() => setOpen(true)}
        data-testid="header-search-mobile"
      >
        <SearchIcon className="size-5" />
      </Button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-8 w-56 items-center gap-2 rounded-lg border border-topbar-border bg-content-bg px-2.5 text-left text-[13px] text-mid-dark transition-colors hover:border-sage/30 md:flex lg:w-64"
        data-testid="header-search"
      >
        <SearchIcon className="size-4 shrink-0" />
        <span className="flex-1 truncate">Buscar paciente</span>
        <kbd className="rounded border border-topbar-border bg-white px-1.5 font-sans text-[10px] text-mid-dark">Ctrl K</kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Buscar paciente"
        description="Digite o nome, telefone ou CPF do paciente."
        className="top-[calc(1rem+env(safe-area-inset-top))] sm:top-1/4"
      >
        <Command shouldFilter={false} vimBindings={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Nome, telefone ou CPF"
            className="h-11 text-base md:h-8 md:text-sm"
            data-testid="patient-search-input"
          />
          <CommandList>
            {hint ? (
              <p className="py-6 text-center text-sm text-mid-dark">{hint}</p>
            ) : (
              <>
                <CommandEmpty>Nenhum paciente encontrado.</CommandEmpty>
                {results?.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    onSelect={() => goTo(p.id)}
                    className="min-h-11 gap-3 px-3 md:min-h-9"
                  >
                    <UserRound className="text-sage" />
                    <span className="min-w-0 flex-1 truncate text-charcoal">{p.fullName}</span>
                    {p.phone && <span className="shrink-0 text-xs text-mid-dark">{formatBrPhone(p.phone)}</span>}
                  </CommandItem>
                ))}
              </>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}

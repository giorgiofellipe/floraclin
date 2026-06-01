'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Search, User, Phone, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Patient {
  id: string
  fullName: string
  phone: string | null
}

interface StartConversationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConversationStarted: (conversation: { id: string; phoneNumber: string; profileName: string | null; patientId: string | null }) => void
  /**
   * Phone number to pre-search the patient list with. If exactly one patient
   * matches, they're auto-selected. Otherwise the search input is pre-filled
   * so the user can pick.
   */
  preselectedPhone?: string | null
}

export function StartConversationDialog({
  open,
  onOpenChange,
  onConversationStarted,
  preselectedPhone,
}: StartConversationDialogProps) {
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [opening, setOpening] = useState(false)

  const [patientSearch, setPatientSearch] = useState('')
  const [patients, setPatients] = useState<Patient[]>([])
  const [loadingPatients, setLoadingPatients] = useState(false)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      setSelectedPatient(null)
      const initialSearch = preselectedPhone ?? ''
      setPatientSearch(initialSearch)
      if (initialSearch.length >= 2) {
        ;(async () => {
          setLoadingPatients(true)
          try {
            const res = await fetch(`/api/patients?search=${encodeURIComponent(initialSearch)}&limit=10`)
            if (!res.ok) throw new Error()
            const data = await res.json()
            const matches = (data.data ?? []).filter((p: Patient) => p.phone)
            setPatients(matches)
            if (matches.length === 1) {
              openConversation(matches[0])
            }
          } catch {
            setPatients([])
          } finally {
            setLoadingPatients(false)
          }
        })()
      } else {
        setPatients([])
      }
    }
  }, [open, preselectedPhone])

  const fetchPatients = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setPatients([])
      return
    }
    setLoadingPatients(true)
    try {
      const res = await fetch(`/api/patients?search=${encodeURIComponent(query)}&limit=10`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setPatients(
        (data.data ?? []).filter((p: Patient) => p.phone),
      )
    } catch {
      setPatients([])
    } finally {
      setLoadingPatients(false)
    }
  }, [])

  function handlePatientSearchChange(value: string) {
    setPatientSearch(value)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      fetchPatients(value)
    }, 300)
  }

  async function openConversation(patient: Patient) {
    setSelectedPatient(patient)
    setOpening(true)
    try {
      const res = await fetch('/api/whatsapp/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId: patient.id }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao abrir conversa' }))
        throw new Error(err.error || 'Erro ao abrir conversa')
      }
      const data = await res.json()
      onOpenChange(false)
      onConversationStarted(data.data.conversation)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao abrir conversa')
    } finally {
      setOpening(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
          <DialogDescription>
            Busque por nome ou telefone para iniciar a conversa via WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mid" />
          <Input
            placeholder="Buscar paciente por nome ou telefone..."
            value={patientSearch}
            onChange={(e) => handlePatientSearchChange(e.target.value)}
            className="pl-8 h-9 text-sm"
            autoFocus
          />
        </div>

        <div className="max-h-72 overflow-y-auto space-y-1">
          {loadingPatients && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {!loadingPatients && patientSearch.length >= 2 && patients.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Nenhum paciente com telefone encontrado.
            </div>
          )}

          {!loadingPatients && patientSearch.length < 2 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Digite ao menos 2 caracteres para buscar.
            </div>
          )}

          {patients.map((patient) => (
            <button
              key={patient.id}
              type="button"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
              onClick={() => openConversation(patient)}
              disabled={opening}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sage/15 text-sm font-medium text-sage">
                {opening && selectedPatient?.id === patient.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <User className="size-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-charcoal">{patient.fullName}</p>
                <p className="flex items-center gap-1 text-xs text-mid">
                  <Phone className="size-3" />
                  {patient.phone}
                </p>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Search, User, Phone, Link2Off } from 'lucide-react'
import { toast } from 'sonner'

interface Patient {
  id: string
  fullName: string
  phone: string | null
}

interface LinkPatientDialogProps {
  conversationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPatientId?: string | null
  onLinked?: (patientId: string | null) => void
}

export function LinkPatientDialog({
  conversationId,
  open,
  onOpenChange,
  currentPatientId,
  onLinked,
}: LinkPatientDialogProps) {
  const [search, setSearch] = useState('')
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      setSearch('')
      setPatients([])
    }
  }, [open])

  const fetchPatients = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setPatients([])
      return
    }
    setLoading(true)
    try {
      const res = await fetch(
        `/api/patients?search=${encodeURIComponent(query)}&limit=10`,
      )
      if (!res.ok) throw new Error()
      const data = await res.json()
      setPatients((data.data ?? []) as Patient[])
    } catch {
      setPatients([])
    } finally {
      setLoading(false)
    }
  }, [])

  function handleSearchChange(value: string) {
    setSearch(value)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      fetchPatients(value)
    }, 300)
  }

  async function linkPatient(patientId: string) {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/instagram/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link_patient', patientId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao vincular paciente' }))
        throw new Error(err.error || 'Erro ao vincular paciente')
      }
      toast.success('Paciente vinculado')
      onLinked?.(patientId)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao vincular paciente')
    } finally {
      setSubmitting(false)
    }
  }

  async function unlinkPatient() {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/instagram/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlink_patient' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao desvincular paciente' }))
        throw new Error(err.error || 'Erro ao desvincular paciente')
      }
      toast.success('Paciente desvinculado')
      onLinked?.(null)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao desvincular paciente')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular a paciente</DialogTitle>
          <DialogDescription>
            Busque um paciente para vincular a esta conversa do Instagram.
          </DialogDescription>
        </DialogHeader>

        {currentPatientId && (
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
            <span className="text-xs text-mid">
              Esta conversa já está vinculada a um paciente.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={unlinkPatient}
              disabled={submitting}
            >
              <Link2Off className="size-3.5" />
              Desvincular
            </Button>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mid" />
          <Input
            placeholder="Buscar paciente por nome ou telefone..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-8 h-9 text-sm"
            autoFocus
          />
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {!loading && search.length >= 2 && patients.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Nenhum paciente encontrado.
            </div>
          )}

          {!loading && search.length < 2 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Digite ao menos 2 caracteres para buscar.
            </div>
          )}

          {patients.map((patient) => (
            <button
              key={patient.id}
              type="button"
              disabled={submitting || patient.id === currentPatientId}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
              onClick={() => linkPatient(patient.id)}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sage/15 text-sm font-medium text-sage">
                <User className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-charcoal">
                  {patient.fullName}
                </p>
                {patient.phone && (
                  <p className="flex items-center gap-1 text-xs text-mid">
                    <Phone className="size-3" />
                    {patient.phone}
                  </p>
                )}
              </div>
              {patient.id === currentPatientId && (
                <span className="text-[10px] text-mid">Vinculado</span>
              )}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

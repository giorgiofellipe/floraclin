'use client'

import { useState, useCallback, useEffect } from 'react'
import { Search, UserPlus, Loader2 } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Prospect } from './types'

interface PatientResult {
  id: string
  fullName: string
  phone: string | null
}

interface ConvertProspectModalProps {
  prospect: Prospect | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConverted: () => void
}

export function ConvertProspectModal({
  prospect,
  open,
  onOpenChange,
  onConverted,
}: ConvertProspectModalProps) {
  const [mode, setMode] = useState<'search' | 'create'>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PatientResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    null
  )
  const [newPatientName, setNewPatientName] = useState('')
  const [newPatientPhone, setNewPatientPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pre-fill new patient form from prospect data
  useEffect(() => {
    if (prospect && open) {
      setNewPatientName(prospect.name || '')
      setNewPatientPhone(prospect.phone || '')
      setMode('search')
      setSearchQuery('')
      setSearchResults([])
      setSelectedPatientId(null)
      setError(null)
    }
  }, [prospect, open])

  const searchPatients = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const params = new URLSearchParams({ search: query, limit: '10' })
      const res = await fetch(`/api/patients?${params}`)
      if (res.ok) {
        const data = await res.json()
        setSearchResults(
          (data.data || []).map(
            (p: { id: string; fullName: string; phone?: string | null }) => ({
              id: p.id,
              fullName: p.fullName,
              phone: p.phone ?? null,
            })
          )
        )
      }
    } finally {
      setSearching(false)
    }
  }, [])

  const handleSubmit = async () => {
    if (!prospect) return
    setSubmitting(true)
    setError(null)

    try {
      const body: Record<string, unknown> =
        mode === 'search' && selectedPatientId
          ? { patientId: selectedPatientId }
          : { createPatient: { fullName: newPatientName, phone: newPatientPhone } }

      const res = await fetch(`/api/crm/prospects/${prospect.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(
          (err as { error?: string }).error || 'Erro ao converter prospect'
        )
      }

      onConverted()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    mode === 'search'
      ? !!selectedPatientId
      : newPatientName.trim().length > 0 && newPatientPhone.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Converter para Paciente</DialogTitle>
          <DialogDescription>
            Vincule este prospect a um paciente existente ou crie um novo.
          </DialogDescription>
        </DialogHeader>

        {/* Mode tabs */}
        <div className="flex gap-1 rounded-lg bg-[#F4F6F8] p-1">
          <button
            type="button"
            onClick={() => setMode('search')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'search'
                ? 'bg-white text-[#2A2A2A] shadow-sm'
                : 'text-[#7A7A7A] hover:text-[#2A2A2A]'
            }`}
          >
            <Search className="h-3.5 w-3.5" />
            Buscar existente
          </button>
          <button
            type="button"
            onClick={() => setMode('create')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'create'
                ? 'bg-white text-[#2A2A2A] shadow-sm'
                : 'text-[#7A7A7A] hover:text-[#2A2A2A]'
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Criar novo
          </button>
        </div>

        {mode === 'search' ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#B0B0B0]" />
              <Input
                placeholder="Buscar por nome ou telefone..."
                value={searchQuery}
                onChange={(e) => {
                  const v = e.target.value
                  setSearchQuery(v)
                  setSelectedPatientId(null)
                  searchPatients(v)
                }}
                className="pl-9"
              />
            </div>

            {searching && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-[#7A7A7A]" />
              </div>
            )}

            {!searching && searchResults.length > 0 && (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {searchResults.map((patient) => (
                  <button
                    key={patient.id}
                    type="button"
                    onClick={() => setSelectedPatientId(patient.id)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      selectedPatientId === patient.id
                        ? 'border-forest bg-[#F0F7F1]'
                        : 'border-transparent hover:bg-[#F4F6F8]'
                    }`}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E8ECEF] text-xs font-medium text-[#7A7A7A]">
                      {patient.fullName
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2)}
                    </div>
                    <div>
                      <div className="font-medium text-[#2A2A2A]">
                        {patient.fullName}
                      </div>
                      {patient.phone && (
                        <div className="text-xs text-[#7A7A7A]">
                          {patient.phone}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {!searching &&
              searchQuery.length >= 2 &&
              searchResults.length === 0 && (
                <p className="py-4 text-center text-sm text-[#7A7A7A]">
                  Nenhum paciente encontrado.{' '}
                  <button
                    type="button"
                    onClick={() => setMode('create')}
                    className="text-forest underline"
                  >
                    Criar novo
                  </button>
                </p>
              )}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="convert-name">Nome completo</Label>
              <Input
                id="convert-name"
                value={newPatientName}
                onChange={(e) => setNewPatientName(e.target.value)}
                placeholder="Nome do paciente"
              />
            </div>
            <div>
              <Label htmlFor="convert-phone">Telefone</Label>
              <Input
                id="convert-phone"
                value={newPatientPhone}
                onChange={(e) => setNewPatientPhone(e.target.value)}
                placeholder="(11) 99999-9999"
              />
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
          >
            {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Converter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

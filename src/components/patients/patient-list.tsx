'use client'

import { useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { Patient } from '@/db/queries/patients'
import type { PaginatedResult } from '@/types'
import { useDeletePatient } from '@/hooks/mutations/use-patient-mutations'
import { cn, formatDate, maskCPF } from '@/lib/utils'
import { PatientForm } from './patient-form'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { PlusIcon, SearchIcon, PencilIcon, TrashIcon, ChevronLeftIcon, ChevronRightIcon, UsersIcon } from 'lucide-react'

interface PatientListProps {
  result: PaginatedResult<Patient>
  search?: string
  isFetching?: boolean
}

export function PatientList({ result, search: initialSearch = '', isFetching = false }: PatientListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const deletePatientMutation = useDeletePatient()
  const [searchValue, setSearchValue] = useState(initialSearch)
  const [formOpen, setFormOpen] = useState(false)
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null)
  const [deletePatient, setDeletePatient] = useState<Patient | null>(null)
  const isPending = deletePatientMutation.isPending

  const currentPage = result.page

  const handleSearch = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (searchValue.trim()) {
      params.set('busca', searchValue.trim())
    } else {
      params.delete('busca')
    }
    params.delete('pagina')
    router.push(`/pacientes?${params.toString()}`)
  }, [searchValue, searchParams, router])

  const handlePageChange = useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(searchParams.toString())
      if (newPage > 1) {
        params.set('pagina', String(newPage))
      } else {
        params.delete('pagina')
      }
      router.push(`/pacientes?${params.toString()}`)
    },
    [searchParams, router]
  )

  const handleDelete = useCallback(async () => {
    if (!deletePatient) return
    try {
      await deletePatientMutation.mutateAsync(deletePatient.id)
      setDeletePatient(null)
      router.refresh()
    } catch {
      // error handled by mutation
    }
  }, [deletePatient, router, deletePatientMutation])

  const handleEdit = useCallback((patient: Patient) => {
    setEditingPatient(patient)
    setFormOpen(true)
  }, [])

  const handleNewPatient = useCallback(() => {
    setEditingPatient(null)
    setFormOpen(true)
  }, [])

  /** Build initials from the patient's full name (max 2 chars) */
  function getInitials(name: string) {
    const parts = name.trim().split(/\s+/)
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Search + actions */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-lg">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-mid pointer-events-none" />
          <Input
            placeholder="Buscar por nome, telefone ou CPF..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch()
            }}
            className="pl-10 rounded-lg border-blush/60 focus:shadow-md focus:ring-sage/30 transition-shadow"
            data-testid="patient-search"
          />
        </div>
        <Button variant="outline" onClick={handleSearch} className="border-sage/30 text-sage hover:bg-petal transition-colors">
          Buscar
        </Button>
        <div className="flex-1" />
        <Button onClick={handleNewPatient} className="bg-forest text-cream hover:bg-sage transition-colors" data-testid="patient-new-button">
          <PlusIcon className="size-4" data-icon="inline-start" />
          Novo Paciente
        </Button>
      </div>

      {/* Table */}
      <div className={cn("rounded-[3px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden transition-opacity duration-200", isFetching && "opacity-60")}>
        <Table>
          <TableHeader>
            <TableRow className="border-b border-[#E8ECEF] hover:bg-transparent">
              <TableHead className="text-xs uppercase tracking-wider text-mid font-medium">Nome</TableHead>
              <TableHead className="text-xs uppercase tracking-wider text-mid font-medium">Telefone</TableHead>
              <TableHead className="hidden md:table-cell text-xs uppercase tracking-wider text-mid font-medium">E-mail</TableHead>
              <TableHead className="hidden md:table-cell text-xs uppercase tracking-wider text-mid font-medium">CPF</TableHead>
              <TableHead className="hidden lg:table-cell text-xs uppercase tracking-wider text-mid font-medium">Cadastro</TableHead>
              <TableHead className="w-[100px] text-xs uppercase tracking-wider text-mid font-medium">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-48" data-testid="patient-empty-state">
                  <div className="flex flex-col items-center justify-center gap-3 text-center">
                    <div className="flex size-14 items-center justify-center rounded-full bg-white">
                      <UsersIcon className="size-6 text-sage" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-charcoal">
                        {initialSearch ? 'Nenhum resultado encontrado' : 'Nenhum paciente cadastrado'}
                      </p>
                      <p className="text-sm text-mid">
                        {initialSearch
                          ? 'Tente uma busca diferente ou ajuste os termos.'
                          : 'Comece cadastrando seu primeiro paciente.'}
                      </p>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              result.data.map((patient, index) => (
                <TableRow key={patient.id} data-testid={`patient-row-${index}`} className="border-b border-[#E8ECEF] hover:bg-[#F4F6F8] transition-colors">
                  <TableCell>
                    <Link
                      href={`/pacientes/${patient.id}`}
                      className="flex items-center gap-3 group"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sage/15 text-xs font-medium text-sage">
                        {getInitials(patient.fullName)}
                      </span>
                      <span className="font-medium text-charcoal group-hover:text-forest transition-colors">
                        {patient.fullName}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-mid">{patient.phone}</TableCell>
                  <TableCell className="hidden md:table-cell text-mid">
                    {patient.email || '—'}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-mid">
                    {patient.cpf ? maskCPF(patient.cpf) : '—'}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-mid">
                    {formatDate(patient.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleEdit(patient)}
                        title="Editar"
                        className="text-mid hover:text-forest hover:bg-sage/10 transition-colors"
                      >
                        <PencilIcon className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDeletePatient(patient)}
                        title="Excluir"
                        className="text-mid hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <TrashIcon className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-mid">
            Página {currentPage} de {result.totalPages}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => handlePageChange(currentPage - 1)}
              className="text-xs text-mid hover:text-forest hover:bg-petal transition-colors disabled:opacity-40"
            >
              <ChevronLeftIcon className="size-3.5" />
              Anterior
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={currentPage >= result.totalPages}
              onClick={() => handlePageChange(currentPage + 1)}
              className="text-xs text-mid hover:text-forest hover:bg-petal transition-colors disabled:opacity-40"
            >
              Próxima
              <ChevronRightIcon className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Patient Form Sheet */}
      <PatientForm
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setEditingPatient(null)
        }}
        patient={editingPatient}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={!!deletePatient} onOpenChange={(open) => !open && setDeletePatient(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir paciente</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir o paciente{' '}
              <strong>{deletePatient?.fullName}</strong>? Esta ação pode ser revertida
              posteriormente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending ? 'Excluindo...' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

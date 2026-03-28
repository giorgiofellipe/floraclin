'use client'

import { useState, useTransition, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { Patient } from '@/db/queries/patients'
import type { PaginatedResult } from '@/types'
import { deletePatientAction } from '@/actions/patients'
import { formatDate } from '@/lib/utils'
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
import { PlusIcon, SearchIcon, PencilIcon, TrashIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

interface PatientListProps {
  result: PaginatedResult<Patient>
  search?: string
}

export function PatientList({ result, search: initialSearch = '' }: PatientListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchValue, setSearchValue] = useState(initialSearch)
  const [formOpen, setFormOpen] = useState(false)
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null)
  const [deletePatient, setDeletePatient] = useState<Patient | null>(null)
  const [isPending, startTransition] = useTransition()

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

  const handleDelete = useCallback(() => {
    if (!deletePatient) return
    startTransition(async () => {
      await deletePatientAction(deletePatient.id)
      setDeletePatient(null)
      router.refresh()
    })
  }, [deletePatient, router])

  const handleEdit = useCallback((patient: Patient) => {
    setEditingPatient(patient)
    setFormOpen(true)
  }, [])

  const handleNewPatient = useCallback(() => {
    setEditingPatient(null)
    setFormOpen(true)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pacientes</h1>
          <p className="text-sm text-muted-foreground">
            {result.total} {result.total === 1 ? 'paciente cadastrado' : 'pacientes cadastrados'}
          </p>
        </div>
        <Button onClick={handleNewPatient}>
          <PlusIcon className="size-4" data-icon="inline-start" />
          Novo Paciente
        </Button>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar por nome, telefone ou CPF..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch()
            }}
            className="pl-8"
          />
        </div>
        <Button variant="outline" onClick={handleSearch}>
          Buscar
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead className="hidden md:table-cell">E-mail</TableHead>
              <TableHead className="hidden md:table-cell">CPF</TableHead>
              <TableHead className="hidden lg:table-cell">Cadastro</TableHead>
              <TableHead className="w-[100px]">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  {initialSearch
                    ? 'Nenhum paciente encontrado para esta busca.'
                    : 'Nenhum paciente cadastrado. Clique em "Novo Paciente" para começar.'}
                </TableCell>
              </TableRow>
            ) : (
              result.data.map((patient) => (
                <TableRow key={patient.id}>
                  <TableCell>
                    <Link
                      href={`/pacientes/${patient.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {patient.fullName}
                    </Link>
                  </TableCell>
                  <TableCell>{patient.phone}</TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {patient.email || '—'}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {patient.cpf || '—'}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {formatDate(patient.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleEdit(patient)}
                        title="Editar"
                      >
                        <PencilIcon className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDeletePatient(patient)}
                        title="Excluir"
                      >
                        <TrashIcon className="size-3.5 text-destructive" />
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
          <p className="text-sm text-muted-foreground">
            Página {currentPage} de {result.totalPages}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => handlePageChange(currentPage - 1)}
            >
              <ChevronLeftIcon className="size-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= result.totalPages}
              onClick={() => handlePageChange(currentPage + 1)}
            >
              Próxima
              <ChevronRightIcon className="size-4" />
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

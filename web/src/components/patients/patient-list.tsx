'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { PatientListRow } from '@/db/queries/patients'
import type { PaginatedResult } from '@/types'
import type { PatientSortKey, SortDirection } from '@/validations/patient'
import { cn, formatDate, redactCPF } from '@/lib/utils'
import { brToday } from '@/lib/dates'
import { monthRange } from '@/lib/birthdays'
import { newAppointmentPathFor } from '@/lib/deep-links'
import { formatBrPhone } from '@/lib/phone'
import { canWriteFrontDesk } from '@/lib/constants'
import { useBirthdays } from '@/hooks/queries/use-birthdays'
import { PatientForm } from './patient-form'
import { PatientWhatsappButton } from './patient-whatsapp-button'
import { formatLastVisit, formatNextAppointment } from './patient-list-dates'

import { Button, buttonVariants } from '@/components/ui/button'
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
  ArrowDownIcon,
  ArrowUpIcon,
  CakeIcon,
  CalendarPlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
} from 'lucide-react'
import { ReadOnlyGuard, useSubscriptionAccess } from '@/components/layout/subscription-access'

const SEARCH_DEBOUNCE_MS = 300
// Tailwind `md`, where the table replaces the cards.
const DESKTOP_QUERY = '(min-width: 768px)'

const DEFAULT_DIRECTION: Record<PatientSortKey, SortDirection> = {
  nome: 'asc',
  proximo: 'asc',
  'ultima-visita': 'desc',
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const

const CARD_SHADOW = 'shadow-[0_1px_4px_rgba(0,0,0,0.06)]'

const ROW_ACTION = 'size-11 md:size-9 rounded-xl text-sage hover:bg-sage/10 hover:text-forest transition-colors'

interface PatientListProps {
  result: PaginatedResult<PatientListRow>
  search?: string
  sort?: PatientSortKey
  direction?: SortDirection
  isFetching?: boolean
  whatsappInApp?: boolean
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

function identityLine(patient: PatientListRow): string {
  return [patient.email, patient.cpf && `CPF ${redactCPF(patient.cpf)}`].filter(Boolean).join(' · ')
}

function PatientAvatar({ name, className }: { name: string; className: string }) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-sage/15 font-medium text-sage', className)}>
      {getInitials(name)}
    </span>
  )
}

export function PatientList({
  result,
  search: initialSearch = '',
  sort = 'nome',
  direction = 'asc',
  isFetching = false,
  whatsappInApp = false,
}: PatientListProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchValue, setSearchValue] = useState(initialSearch)
  const [submittedSearch, setSubmittedSearch] = useState(initialSearch)
  const [urlSearch, setUrlSearch] = useState(initialSearch)
  // A `busca` this input did not submit (back/forward, a link) replaces what is typed.
  if (initialSearch !== urlSearch) {
    setUrlSearch(initialSearch)
    if (initialSearch !== submittedSearch) {
      setSearchValue(initialSearch)
      setSubmittedSearch(initialSearch)
    }
  }
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const novoParam = searchParams.get('novo')
  const nomeParam = searchParams.get('nome')
  const telefoneParam = searchParams.get('telefone')
  // `?novo=1` comes from the trial checklist and a lifecycle email; in
  // read-only mode it must not open a form whose save would 402.
  const { readOnly, role } = useSubscriptionAccess()
  const canWrite = canWriteFrontDesk(role)
  const [formOpen, setFormOpen] = useState(novoParam === '1' && !readOnly && canWrite)
  const [editingPatient, setEditingPatient] = useState<PatientListRow | null>(null)
  const [prefillData] = useState(
    novoParam === '1' ? { fullName: nomeParam ?? '', phone: telefoneParam ?? '' } : null
  )

  const today = brToday()
  const birthdayRange = monthRange(Number(today.slice(0, 4)), Number(today.slice(5, 7)))
  const { data: birthdays } = useBirthdays(birthdayRange)

  const currentPage = result.page
  const isEmptyClinic = result.total === 0 && !initialSearch

  // Phones skip the focus: the keyboard would cover half of the list on arrival.
  const focusSearchOnOpen = useRef(!formOpen && !isEmptyClinic)
  const searchInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusSearchOnOpen.current && window.matchMedia(DESKTOP_QUERY).matches) searchInputRef.current?.focus()
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [])

  const updateParams = useCallback(
    (mutate: (params: URLSearchParams) => void | false) => {
      // Read the live URL: a debounced search fires after a sort click may have changed it.
      const params = new URLSearchParams(window.location.search)
      if (mutate(params) === false) return
      const query = params.toString()
      router.replace(query ? `/pacientes?${query}` : '/pacientes', { scroll: false })
    },
    [router]
  )

  const applySearch = useCallback(
    (value: string) => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      searchTimer.current = null
      const trimmed = value.trim()
      setSubmittedSearch(trimmed)
      updateParams((params) => {
        if (trimmed === (params.get('busca') ?? '')) return false
        if (trimmed) params.set('busca', trimmed)
        else params.delete('busca')
        params.delete('pagina')
      })
    },
    [updateParams]
  )

  function handleSearchChange(value: string) {
    setSearchValue(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => applySearch(value), SEARCH_DEBOUNCE_MS)
  }

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

  function handleSort(key: PatientSortKey) {
    const flipped: SortDirection = direction === 'asc' ? 'desc' : 'asc'
    const nextDirection = key === sort ? flipped : DEFAULT_DIRECTION[key]
    updateParams((params) => {
      if (key === 'nome' && nextDirection === 'asc') {
        params.delete('ordem')
        params.delete('direcao')
      } else {
        params.set('ordem', key)
        params.set('direcao', nextDirection)
      }
      params.delete('pagina')
    })
  }

  function sortHeader(key: PatientSortKey, label: string, className?: string) {
    const active = sort === key
    const SortIcon = direction === 'asc' ? ArrowUpIcon : ArrowDownIcon
    return (
      <TableHead
        className={cn('text-xs uppercase tracking-wider text-mid font-medium', className)}
        aria-sort={active ? ARIA_SORT[direction] : 'none'}
      >
        <button
          type="button"
          onClick={() => handleSort(key)}
          className={cn(
            'inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-forest',
            active && 'text-forest'
          )}
        >
          {label}
          {active && <SortIcon className="size-3" aria-hidden />}
        </button>
      </TableHead>
    )
  }

  function rowActions(patient: PatientListRow) {
    return (
      <>
        <PatientWhatsappButton patient={patient} inAppAllowed={whatsappInApp} className={ROW_ACTION} />
        {canWrite && (
          <ReadOnlyGuard label={`Agendar ${patient.fullName}`}>
            <Link
              href={newAppointmentPathFor(patient)}
              aria-label={`Agendar ${patient.fullName}`}
              title="Agendar"
              className={cn(buttonVariants({ variant: 'ghost' }), ROW_ACTION)}
            >
              <CalendarPlusIcon className="size-4" />
            </Link>
          </ReadOnlyGuard>
        )}
        {canWrite && (
          <ReadOnlyGuard label={`Editar ${patient.fullName}`}>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Editar ${patient.fullName}`}
              title="Editar"
              onClick={() => {
                setEditingPatient(patient)
                setFormOpen(true)
              }}
              className={ROW_ACTION}
            >
              <PencilIcon className="size-4" />
            </Button>
          </ReadOnlyGuard>
        )}
      </>
    )
  }

  const newPatientButton = (label: string) => (
    <ReadOnlyGuard label={label}>
      <Button
        onClick={() => {
          setEditingPatient(null)
          setFormOpen(true)
        }}
        className="h-11 md:h-9 bg-forest text-cream hover:bg-sage transition-colors"
        data-testid="patient-new-button"
      >
        <PlusIcon className="size-4" data-icon="inline-start" />
        {label}
      </Button>
    </ReadOnlyGuard>
  )

  const onlyPatient =
    result.total === 1 && !initialSearch && !result.data[0]?.nextAppointmentAt && !result.data[0]?.lastVisitDate
      ? result.data[0]
      : null

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* Search + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full md:w-auto md:max-w-lg md:flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-mid pointer-events-none" />
          <Input
            type="search"
            placeholder="Buscar por nome, telefone ou CPF..."
            aria-label="Buscar pacientes"
            value={searchValue}
            ref={searchInputRef}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applySearch(searchValue)
            }}
            className="h-11 md:h-9 pl-10 border-sage/20"
            data-testid="patient-search"
          />
        </div>
        {!isEmptyClinic && (
          <Link
            href="/pacientes/aniversariantes"
            className="inline-flex h-11 md:h-9 items-center gap-1.5 rounded-full border border-sage/20 bg-white px-3 text-sm text-charcoal transition-colors hover:bg-petal"
            data-testid="patient-birthdays-chip"
          >
            <CakeIcon className="size-4 text-sage" />
            Aniversariantes
            {birthdays && (
              <span className="rounded-full bg-sage/10 px-2 text-xs text-forest">
                {birthdays.length}
                <span className="max-md:sr-only"> este mês</span>
              </span>
            )}
          </Link>
        )}
        <div className="flex-1" />
        {canWrite && !isEmptyClinic && newPatientButton('Novo Paciente')}
      </div>

      {onlyPatient && canWrite && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[3px] border border-sage/20 bg-petal/40 px-4 py-3">
          <p className="text-sm text-charcoal">
            Agende a primeira consulta de <strong className="font-medium">{onlyPatient.fullName}</strong>.
          </p>
          <ReadOnlyGuard label="Agendar">
            <Link
              href={newAppointmentPathFor(onlyPatient)}
              className={cn(buttonVariants({ variant: 'outline' }), 'h-11 md:h-9 border-sage/30 text-forest hover:bg-petal')}
            >
              <CalendarPlusIcon className="size-4" data-icon="inline-start" />
              Agendar
            </Link>
          </ReadOnlyGuard>
        </div>
      )}

      {result.data.length === 0 ? (
        <div
          className={cn('flex flex-col items-center justify-center gap-4 rounded-[3px] bg-white px-4 py-12 text-center', CARD_SHADOW)}
          data-testid="patient-empty-state"
        >
          <div className="flex size-14 items-center justify-center rounded-full bg-sage/10">
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
          {canWrite && isEmptyClinic && newPatientButton('Cadastrar primeiro paciente')}
        </div>
      ) : (
        <div className={cn('transition-opacity duration-200', isFetching && 'opacity-60')}>
          {/* Phone: one card per patient */}
          <ul className="flex flex-col gap-2 md:hidden" data-testid="patient-cards">
            {result.data.map((patient, index) => (
              <li
                key={patient.id}
                data-testid={`patient-card-${index}`}
                className={cn('flex items-center gap-1 rounded-[3px] bg-white py-2 pl-3 pr-1', CARD_SHADOW)}
              >
                <Link href={`/pacientes/${patient.id}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-3">
                  <PatientAvatar name={patient.fullName} className="size-10 text-sm" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-charcoal">{patient.fullName}</span>
                    <span className="truncate text-xs text-mid">{formatBrPhone(patient.phone)}</span>
                    {identityLine(patient) && (
                      <span className="truncate text-xs text-mid">{identityLine(patient)}</span>
                    )}
                    {patient.nextAppointmentAt && (
                      <span className="truncate text-xs text-forest">
                        Próximo: {formatNextAppointment(patient.nextAppointmentAt, today)}
                      </span>
                    )}
                  </span>
                </Link>
                {rowActions(patient)}
              </li>
            ))}
          </ul>

          {/* Desktop table */}
          <div className={cn('hidden md:block rounded-[3px] bg-white overflow-hidden', CARD_SHADOW)}>
            <Table>
              <TableHeader>
                <TableRow className="border-b border-topbar-border hover:bg-transparent">
                  {sortHeader('nome', 'Nome')}
                  <TableHead className="text-xs uppercase tracking-wider text-mid font-medium">Telefone</TableHead>
                  {sortHeader('proximo', 'Próximo agendamento')}
                  {sortHeader('ultima-visita', 'Última visita')}
                  <TableHead className="hidden lg:table-cell text-xs uppercase tracking-wider text-mid font-medium">Cadastro</TableHead>
                  <TableHead className="w-[140px] text-xs uppercase tracking-wider text-mid font-medium">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.data.map((patient, index) => (
                  <TableRow key={patient.id} data-testid={`patient-row-${index}`} className="border-b border-topbar-border hover:bg-content-bg transition-colors">
                    <TableCell>
                      <Link href={`/pacientes/${patient.id}`} className="flex items-center gap-3 group">
                        <PatientAvatar name={patient.fullName} className="size-8 text-xs" />
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium text-charcoal group-hover:text-forest transition-colors">
                            {patient.fullName}
                          </span>
                          {identityLine(patient) && (
                            <span className="text-xs text-mid">{identityLine(patient)}</span>
                          )}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-mid">{formatBrPhone(patient.phone)}</TableCell>
                    <TableCell className={patient.nextAppointmentAt ? 'text-charcoal' : 'text-mid'}>
                      {patient.nextAppointmentAt ? formatNextAppointment(patient.nextAppointmentAt, today) : '-'}
                    </TableCell>
                    <TableCell className="text-mid">
                      {patient.lastVisitDate ? formatLastVisit(patient.lastVisitDate, today) : '-'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-mid">{formatDate(patient.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-0.5">{rowActions(patient)}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

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
              className="h-11 md:h-7 text-xs text-mid hover:text-forest hover:bg-petal transition-colors disabled:opacity-40"
            >
              <ChevronLeftIcon className="size-3.5" />
              Anterior
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={currentPage >= result.totalPages}
              onClick={() => handlePageChange(currentPage + 1)}
              className="h-11 md:h-7 text-xs text-mid hover:text-forest hover:bg-petal transition-colors disabled:opacity-40"
            >
              Próxima
              <ChevronRightIcon className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <PatientForm
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setEditingPatient(null)
        }}
        patient={editingPatient}
        prefill={prefillData ?? undefined}
      />
    </div>
  )
}

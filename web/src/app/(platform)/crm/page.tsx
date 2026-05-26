'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, Loader2, RefreshCw, Plus } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { KanbanBoard } from '@/components/crm/kanban-board'
import { AddProspectModal } from '@/components/crm/add-prospect-modal'
import { STAGE_CONFIG, PROSPECT_STAGES } from '@/components/crm/constants'
import type {
  Prospect,
  ProspectStage,
  ProspectStats,
  ProspectsResponse,
  TeamMember,
  ProcedureTypeOption,
} from '@/components/crm/types'

export default function CrmPage() {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [stats, setStats] = useState<ProspectStats>({
    novo: 0,
    contatado: 0,
    qualificado: 0,
    agendado: 0,
    convertido: 0,
    perdido: 0,
  })
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [procedureTypes, setProcedureTypes] = useState<ProcedureTypeOption[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)

  const fetchProspects = useCallback(async (searchQuery = '') => {
    try {
      const params = new URLSearchParams()
      if (searchQuery) params.set('search', searchQuery)

      const res = await fetch(`/api/crm/prospects?${params}`)
      if (!res.ok) throw new Error('Erro ao carregar leads')

      const data = await res.json()
      setProspects(data.data)
      setStats(data.stats)
      if (data.members) setTeamMembers(data.members)
      if (data.procedures) setProcedureTypes(data.procedures)
    } catch {
      // Silently handle — the board will show empty columns
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await fetchProspects()
      setLoading(false)
    }
    init()
  }, [fetchProspects])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchProspects(search)
    }, 300)
    return () => clearTimeout(timer)
  }, [search, fetchProspects])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchProspects(search)
    setRefreshing(false)
  }

  const handleStageChange = async (
    prospectId: string,
    newStage: ProspectStage
  ) => {
    // Optimistic update
    setProspects((prev) =>
      prev.map((p) => (p.id === prospectId ? { ...p, stage: newStage } : p))
    )

    // Update stats optimistically
    const prospect = prospects.find((p) => p.id === prospectId)
    if (prospect) {
      setStats((prev) => ({
        ...prev,
        [prospect.stage]: Math.max(0, prev[prospect.stage] - 1),
        [newStage]: prev[newStage] + 1,
      }))
    }

    try {
      const res = await fetch(`/api/crm/prospects/${prospectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage }),
      })

      if (!res.ok) {
        // Revert on failure
        await fetchProspects(search)
      }
    } catch {
      await fetchProspects(search)
    }
  }

  const handleUpdate = async (id: string, data: Partial<Prospect>) => {
    const res = await fetch(`/api/crm/prospects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(
        (err as { error?: string }).error || 'Erro ao atualizar lead'
      )
    }

    // Refresh to get updated data
    await fetchProspects(search)
  }

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/crm/prospects/${id}`, {
      method: 'DELETE',
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(
        (err as { error?: string }).error || 'Erro ao remover lead'
      )
    }

    await fetchProspects(search)
  }

  const totalProspects = Object.values(stats).reduce((a, b) => a + b, 0)

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-64" />
        </div>
        <Skeleton className="h-4 w-96" />
        <div className="flex gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[400px] w-[280px] shrink-0" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4" style={{ height: 'calc(100vh - 52px - 48px)' }}>
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[24px] font-medium text-[#2A2A2A]">
            CRM Pipeline
          </h1>
          <p className="mt-1 text-[13px] text-[#7A7A7A]">
            {totalProspects} lead{totalProspects !== 1 ? 's' : ''} no
            pipeline
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`mr-1 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            />
            Atualizar
          </Button>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#B0B0B0]" />
            <Input
              placeholder="Buscar leads..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64 pl-9"
            />
          </div>

          <Button size="sm" onClick={() => setShowAddModal(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Novo Lead
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap gap-2">
        {PROSPECT_STAGES.map((stage) => {
          const config = STAGE_CONFIG[stage]
          const count = stats[stage]
          return (
            <div
              key={stage}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
              style={{ backgroundColor: config.bg }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: config.color }}
              />
              <span
                className="text-[12px] font-medium"
                style={{ color: config.color }}
              >
                {config.label}
              </span>
              <span
                className="text-[12px] font-semibold"
                style={{ color: config.color }}
              >
                {count}
              </span>
            </div>
          )
        })}
      </div>

      {/* Kanban Board */}
      <div className="min-h-0 flex-1">
        <KanbanBoard
          prospects={prospects}
          stats={stats}
          teamMembers={teamMembers}
          procedureTypes={procedureTypes}
          onStageChange={handleStageChange}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onRefresh={handleRefresh}
        />
      </div>

      <AddProspectModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={() => {
          setShowAddModal(false)
          fetchProspects(search)
        }}
      />
    </div>
  )
}

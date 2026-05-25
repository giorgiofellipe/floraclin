'use client'

import { useState, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'

import type {
  Prospect,
  ProspectStage,
  ProspectStats,
  TeamMember,
} from './types'
import { PROSPECT_STAGES, STAGE_CONFIG } from './constants'
import { ProspectCard } from './prospect-card'
import { ProspectDetailPanel } from './prospect-detail-panel'

interface KanbanBoardProps {
  prospects: Prospect[]
  stats: ProspectStats
  teamMembers: TeamMember[]
  onStageChange: (prospectId: string, newStage: ProspectStage) => Promise<void>
  onUpdate: (id: string, data: Partial<Prospect>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onRefresh: () => void
}

function KanbanColumn({
  stage,
  prospects,
  onCardClick,
}: {
  stage: ProspectStage
  prospects: Prospect[]
  onCardClick: (prospect: Prospect) => void
}) {
  const config = STAGE_CONFIG[stage]
  const { setNodeRef, isOver } = useDroppable({ id: stage })

  const prospectIds = prospects.map((p) => p.id)

  return (
    <div
      className="flex h-full w-[280px] min-w-[280px] flex-col rounded-lg bg-[#F4F6F8]"
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: config.color }}
        />
        <span className="text-sm font-medium text-[#2A2A2A]">
          {config.label}
        </span>
        <span
          className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-medium"
          style={{ backgroundColor: config.bg, color: config.color }}
        >
          {prospects.length}
        </span>
      </div>

      {/* Droppable area */}
      <div
        ref={setNodeRef}
        className={`flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-colors ${
          isOver ? 'bg-[#E8ECEF] rounded-b-lg' : ''
        }`}
        style={{ minHeight: 100 }}
      >
        <SortableContext
          items={prospectIds}
          strategy={verticalListSortingStrategy}
        >
          {prospects.map((prospect) => (
            <ProspectCard
              key={prospect.id}
              prospect={prospect}
              onClick={onCardClick}
            />
          ))}
        </SortableContext>

        {prospects.length === 0 && (
          <div className="flex flex-1 items-center justify-center py-8">
            <p className="text-xs text-[#B0B0B0]">Nenhum prospect</p>
          </div>
        )}
      </div>
    </div>
  )
}

export function KanbanBoard({
  prospects,
  stats,
  teamMembers,
  onStageChange,
  onUpdate,
  onDelete,
  onRefresh,
}: KanbanBoardProps) {
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(
    null
  )
  const [activeProspect, setActiveProspect] = useState<Prospect | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const prospectsByStage = useCallback(
    (stage: ProspectStage) => {
      return prospects.filter((p) => p.stage === stage)
    },
    [prospects]
  )

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const prospect = prospects.find((p) => p.id === active.id)
    if (prospect) {
      setActiveProspect(prospect)
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveProspect(null)

    if (!over) return

    const prospectId = active.id as string
    const prospect = prospects.find((p) => p.id === prospectId)
    if (!prospect) return

    // Check if dropped over a stage column
    const targetStage = PROSPECT_STAGES.includes(over.id as ProspectStage)
      ? (over.id as ProspectStage)
      : null

    // If dropped over another prospect, get that prospect's stage
    let resolvedStage = targetStage
    if (!resolvedStage) {
      const targetProspect = prospects.find((p) => p.id === over.id)
      if (targetProspect) {
        resolvedStage = targetProspect.stage
      }
    }

    if (resolvedStage && resolvedStage !== prospect.stage) {
      await onStageChange(prospectId, resolvedStage)
    }
  }

  const handleCardClick = (prospect: Prospect) => {
    setSelectedProspect(prospect)
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-4">
          {PROSPECT_STAGES.map((stage) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              prospects={prospectsByStage(stage)}
              onCardClick={handleCardClick}
            />
          ))}
        </div>

        <DragOverlay>
          {activeProspect ? (
            <div className="w-[260px] rotate-2 opacity-90">
              <ProspectCard
                prospect={activeProspect}
                onClick={() => {}}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedProspect && (
        <ProspectDetailPanel
          prospect={selectedProspect}
          teamMembers={teamMembers}
          onClose={() => setSelectedProspect(null)}
          onUpdate={async (id, data) => {
            await onUpdate(id, data)
            // Update the selected prospect locally
            setSelectedProspect((prev) =>
              prev && prev.id === id ? { ...prev, ...data } : prev
            )
          }}
          onDelete={async (id) => {
            await onDelete(id)
            setSelectedProspect(null)
          }}
          onConverted={() => {
            setSelectedProspect(null)
            onRefresh()
          }}
        />
      )}
    </>
  )
}

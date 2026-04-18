# Photos Tab — Procedure Grouping Design

## Goal

Rework the patient Fotos tab to show which procedure each photo belongs to and its date, grouping photos by procedure with timeline-stage sub-groups.

## Current State

- `patient-photos-tab.tsx` fetches photos via `usePatientPhotos` hook and groups by `timelineStage` (Pré, Pós-imediato, 7d, 30d, 90d, Outro)
- `photo-grid.tsx` renders a grid with hover actions (zoom, annotate, delete) — already fixed to be always-visible
- `photoAssets` table has `procedureRecordId` (optional FK to `procedure_records`) — the data link exists but the UI ignores it
- Photos without `procedureRecordId` are "orphan" / standalone uploads

## New Behavior

Photos are displayed chronologically, grouped by procedure:

1. **Procedure-linked photos** appear under a header: `Toxina Botulínica — 15 Abr 2026` (procedure type name + performedAt date). Within each group, photos are sub-grouped by timeline stage (same stage labels as today).

2. **Orphan photos** (null `procedureRecordId`) appear inline chronologically by `createdAt` without a procedure header — just their date and stage badge if present.

3. **Sort order**: groups sorted by procedure date descending (newest procedure first). Orphans interleaved by their `createdAt` among the procedure groups.

## Changes

### 1. API/Query — return procedure info with photos

The photos query (likely in `db/queries/photos.ts` or the `/api/photos` route) needs to JOIN `procedure_records` → `procedure_types` to return:
- `procedureTypeName: string | null` (from `procedure_types.name`)
- `procedurePerformedAt: Date | null` (from `procedure_records.performedAt` or `createdAt`)

No new endpoint — extend the existing photo fetch to include these two fields.

### 2. `patient-photos-tab.tsx` — grouping logic

Replace the current stage-only grouping with:
- Group photos by `procedureRecordId`
- For each procedure group: header with type name + date, then sub-group by `timelineStage`
- Orphan photos (null `procedureRecordId`) treated as individual items in the chronological stream
- Sort: procedure groups by `procedurePerformedAt` desc; orphans interleaved by `createdAt`

### 3. `photo-grid.tsx` — no changes needed

The grid renders a flat list of photos. The grouping + headers happen in `patient-photos-tab.tsx` which wraps the grid. The grid component stays as-is.

## Non-goals

- No changes to photo upload flow
- No changes to photo comparison feature
- No new DB columns or migrations
- No changes to the service wizard's photo step

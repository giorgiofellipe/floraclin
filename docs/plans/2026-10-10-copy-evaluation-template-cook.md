# Copy evaluation template from another procedure — cook plan

## Goal

In the Ficha de Avaliação editor (`/configuracoes/avaliacao/[procedureTypeId]`):

1. Add "Copiar de outro procedimento": pick another procedure type that already has a ficha, confirm, and the editor's sections are **replaced** by a deep copy. Nothing is saved until the user clicks "Salvar" (which creates the template if none exists yet, via the existing `handleSave`).
2. Hide "Restaurar padrão" when the procedure's category has no default template (today: `peel`, `laser`, `outros`). Today the button exists for them and fails with "Nenhum template padrão…".

No API change, no migration.

## Decisions

- Replace, not append (user decision). Confirm step before replacing.
- Question/section ids are kept as-is in the copy: `evaluation_responses` rows are keyed by `templateId` and store a `templateSnapshot`, so ids only need to be unique inside one template.
- Copy is `structuredClone(sections)` so editing the copy can never mutate the cached source template.
- Source list: procedure types other than the current one whose template has at least one section. Sorted by procedure name (pt-BR).
- Which categories have a default is derived server-side in `page.tsx` from `defaultTemplates` and passed down as `defaultCategories: string[]`, so the 42KB of default sections never ship to the client and the rule has one source.
- Empty-state copy adapts: with a default → "Adicione seções e perguntas, restaure o modelo padrão ou copie a ficha de outro procedimento."; without → "Adicione seções e perguntas ou copie a ficha de outro procedimento."

## Existing code facts

- `useProcedureTypes()` (`@/hooks/queries/use-procedure-types`) → `{ data: Array<{ id, name, category, ... }> }`.
- `useEvaluationTemplates(typeIds)` (`@/hooks/queries/use-evaluation`) → `{ data: Array<{ id, procedureTypeId, sections, version, ... }> }`, disabled when `typeIds` is empty.
- Dialog primitives: `@/components/ui/dialog` (`Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter`), see `components/evaluation/question-editor-dialog.tsx`.
- Tests: vitest + Testing Library; `renderWithProviders` from `@/tests/test-utils`. Mock hooks with `vi.mock`.
- `TemplateEditor` holds `sections` in `useState(initialSections)`; `hasChanges` compares with `initialSections`.

## Group A (parallel)

### Task 1: CopyTemplateDialog (files: `web/src/components/evaluation/copy-template-dialog.tsx`, `web/src/components/evaluation/__tests__/copy-template-dialog.test.tsx`)

Component:

```tsx
interface CopyTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentProcedureTypeId: string
  onCopy: (sections: EvaluationSection[]) => void
}
```

Behavior:
- `useProcedureTypes()`; `otherIds = types.filter(t => t.id !== currentProcedureTypeId).map(t => t.id)` (memoized); `useEvaluationTemplates(otherIds)`.
- Options = templates with `sections.length > 0` whose `procedureTypeId` is in the types list, joined to the type name; show name and "N perguntas" (sum of `questions.length`, singular "1 pergunta"). Sort by name with `localeCompare(…, 'pt-BR')`.
- Hooks live in an inner `CopyTemplateDialogBody` rendered only inside `DialogContent` while `open`, so nothing is fetched until the dialog opens.
- Loading: `typesLoading || (otherIds.length > 0 && templatesLoading)` → "Carregando...". (TanStack Query v5: a disabled query reports `isLoading=false`, and `isPending` stays true forever when `otherIds` is empty.)
- Error (`typesError || templatesError`) → "Erro ao carregar as fichas. Tente novamente."
- No options → "Nenhum outro procedimento tem ficha de avaliação ainda."
- Step 1: list of option buttons. Clicking one selects it and shows step 2: "Copiar a ficha de **{name}**? Isso substitui as perguntas atuais desta ficha." with "Cancelar" (back to list) and "Copiar" buttons.
- "Copiar" → `onCopy(structuredClone(selected.sections))`, then `onOpenChange(false)`. Reset selection when the dialog closes.
- Title: "Copiar de outro procedimento". Portuguese UI copy, no em dashes.

Test (mock both hooks with `vi.mock`), cases:
1. Lists only other procedures that have a non-empty ficha (current type excluded, type with empty sections excluded, type with no template excluded).
2. Selecting an option then "Copiar" calls `onCopy` with sections equal to the source, and mutating the received copy does not change the source fixture (deep clone).
3. "Cancelar" on the confirm step returns to the list without calling `onCopy`.
4. Empty state message when no option exists, including a tenant whose only procedure type is the current one (templates query disabled; must not stay on "Carregando...").
5. Error state when the templates query errors.
6. Loading state while procedure types load (not the empty-state message).

### Task 2: Plumb `defaultCategories` / `hasDefaultTemplate` / `procedureTypeId` (files: `web/src/app/(platform)/configuracoes/avaliacao/[procedureTypeId]/page.tsx`, `.../evaluation-template-page-client.tsx`, `.../template-editor-page.tsx`)

- `page.tsx` (server): `const { defaultTemplates } = await import('@/lib/default-evaluation-templates')`; pass `defaultCategories={defaultTemplates.map((t) => t.category)}` to `EvaluationTemplatePageClient`.
- `evaluation-template-page-client.tsx`: accept `defaultCategories: string[]`; pass `hasDefaultTemplate={defaultCategories.includes(procedureType.category)}` to `TemplateEditorPage`.
- `template-editor-page.tsx`: accept `hasDefaultTemplate: boolean`; pass `procedureTypeId={procedureType.id}` (replacing the unused `templateId` prop) and `hasDefaultTemplate` to `TemplateEditor`.
- Typecheck will fail until Task 3 adds the props; that is expected between groups.

## Group B (depends on A)

### Task 3: Wire into TemplateEditor (files: `web/src/components/evaluation/template-editor.tsx`, `web/src/components/evaluation/__tests__/template-editor.test.tsx`)

- Props: replace the unused `templateId` prop with `procedureTypeId: string`; add `hasDefaultTemplate: boolean`.
- Render the "Restaurar padrão" control (button and its inline confirm) only when `hasDefaultTemplate`.
- New outline `sm` button before it: `CopyIcon` + `<span className="hidden sm:inline">Copiar de outro procedimento</span>`, `aria-label="Copiar de outro procedimento"`, disabled while `isSaving || isResetting` (a running reset would otherwise overwrite the copy). Opens `CopyTemplateDialog`.
- `onCopy={(copied) => { setSections(copied); toast.success('Ficha copiada. Revise e salve.') }}`.
- Empty-state text per Decisions.

Test (mock `@/hooks/queries/use-procedure-types` and `@/hooks/queries/use-evaluation`), cases:
1. `hasDefaultTemplate={false}` → no "Restaurar padrão" button; `true` → present.
2. Copy flow end to end: open dialog, pick source, confirm → editor shows the source section title and "Alterações não salvas"; `onSave` not called until "Salvar" is clicked, then called with the copied sections.

## Notes

- Permissions: the page has no role check; its only entry is the owner-only settings view, and saves go through `requireWrite('owner')`. Unchanged by this plan.
- Typecheck is red between Group A and B by design; the Group B exit gate is a full typecheck.

## Verification

- `pnpm --filter @floraclin/web typecheck`, `pnpm lint`, `pnpm --filter @floraclin/web test:run`.
- Browser: a procedure in `outros` shows no "Restaurar padrão"; copy into a procedure with no ficha, save, edit, save again (second save must update, not create), reload, sections persisted.

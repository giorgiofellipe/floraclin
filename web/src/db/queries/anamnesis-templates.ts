import equal from 'fast-deep-equal'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { anamnesisTemplates } from '@/db/schema'
import { DEFAULT_ANAMNESIS_TEMPLATE } from '@/lib/anamnesis/default-template'
import type { AnamnesisTemplate } from '@/lib/anamnesis/types'
import type { FormSection } from '@/lib/forms/types'

export type SaveAnamnesisTemplateResult =
  | { changed: false; template: AnamnesisTemplate }
  | { changed: true; id: string; previous: AnamnesisTemplate; template: AnamnesisTemplate }

export async function getCurrentAnamnesisTemplate(tenantId: string): Promise<AnamnesisTemplate> {
  const [row] = await db
    .select({ version: anamnesisTemplates.version, sections: anamnesisTemplates.sections })
    .from(anamnesisTemplates)
    .where(eq(anamnesisTemplates.tenantId, tenantId))
    .limit(1)
  return row ? { version: row.version, sections: row.sections as FormSection[] } : DEFAULT_ANAMNESIS_TEMPLATE
}

export async function saveAnamnesisTemplate(
  tenantId: string,
  sections: FormSection[],
): Promise<SaveAnamnesisTemplateResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(anamnesisTemplates)
      .where(eq(anamnesisTemplates.tenantId, tenantId))
      .for('update')
      .limit(1)
    const previous: AnamnesisTemplate = row
      ? { version: row.version, sections: row.sections as FormSection[] }
      : DEFAULT_ANAMNESIS_TEMPLATE
    if (equal(previous.sections, sections)) return { changed: false, template: previous }

    const [saved] = row
      ? await tx
          .update(anamnesisTemplates)
          .set({ sections, version: row.version + 1, updatedAt: new Date() })
          .where(eq(anamnesisTemplates.id, row.id))
          .returning()
      : await tx
          .insert(anamnesisTemplates)
          .values({ tenantId, sections, version: 1 })
          .onConflictDoUpdate({
            target: anamnesisTemplates.tenantId,
            set: { sections, version: sql`${anamnesisTemplates.version} + 1`, updatedAt: new Date() },
          })
          .returning()
    return {
      changed: true,
      id: saved.id,
      previous,
      template: { version: saved.version, sections: saved.sections as FormSection[] },
    }
  })
}

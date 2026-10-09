import { z } from 'zod'
import { isValidYmd } from '@/lib/dates'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export const createCalendarBlockSchema = z
  .object({
    practitionerId: z.string().uuid().nullable(),
    date: z.string().refine(isValidYmd, 'Data inválida'),
    allDay: z.boolean(),
    startTime: z.string().regex(TIME, 'Horário inválido').optional(),
    endTime: z.string().regex(TIME, 'Horário inválido').optional(),
    title: z.string().trim().max(120, 'Máximo de 120 caracteres').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.allDay) return
    if (!data.startTime || !data.endTime) {
      ctx.addIssue({ code: 'custom', path: ['startTime'], message: 'Informe início e fim' })
      return
    }
    if (data.endTime <= data.startTime) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Fim deve ser depois do início' })
    }
  })

export type CreateCalendarBlockInput = z.infer<typeof createCalendarBlockSchema>

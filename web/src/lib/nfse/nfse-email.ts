import { renderDanfse } from '@bullcode/fiscal/nfse'
import { eq } from 'drizzle-orm'
import { loadDocumentForProcessing, markEmailSent } from '@/db/queries/nfse'
import { db } from '@/db/client'
import { tenants } from '@/db/schema'
import { sendEmailWithAttachments } from '@/lib/email'
import { renderEmailLayout } from '@/lib/email-layout'
import { BusinessError } from '@/lib/errors'

export const PATIENT_EMAIL_MISSING = 'PATIENT_EMAIL_MISSING'

export async function sendNfseEmail(documentId: string): Promise<void> {
  const loaded = await loadDocumentForProcessing(documentId)
  const nfseXml = loaded?.document.nfseXml
  const accessKey = loaded?.document.accessKey
  if (!loaded || !nfseXml || !accessKey) throw new Error('NFS-e not issued')
  const { document, patient } = loaded
  if (!patient.email) throw new BusinessError(PATIENT_EMAIL_MISSING, 'O paciente não tem email cadastrado.')

  const [clinic] = await db
    .select({ name: tenants.name, email: tenants.email })
    .from(tenants)
    .where(eq(tenants.id, document.tenantId))
  const label = document.nfseNumber ?? accessKey
  const paragraphs = [
    `Olá, ${patient.fullName}.`,
    `A ${clinic.name} emitiu a NFS-e referente ao seu pagamento. O PDF e o XML da nota estão em anexo.`,
  ]

  await sendEmailWithAttachments({
    to: patient.email,
    subject: `NFS-e ${label} - ${clinic.name}`,
    html: renderEmailLayout({
      preheader: `NFS-e emitida por ${clinic.name}.`,
      heading: 'Sua NFS-e foi emitida',
      paragraphs,
    }),
    text: paragraphs.join('\n\n'),
    replyTo: clinic.email ?? undefined,
    attachments: [
      { filename: `NFS-e-${label}.pdf`, content: await renderDanfse(nfseXml) },
      { filename: `NFS-e-${label}.xml`, content: Buffer.from(nfseXml) },
    ],
  })
  await markEmailSent(documentId)
}

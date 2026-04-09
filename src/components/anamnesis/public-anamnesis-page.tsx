'use client'

import { useState } from 'react'
import { AnamnesisForm } from './anamnesis-form'
import { CheckCircle2Icon } from 'lucide-react'

interface Props {
  firstName: string
  token: string
  patientId: string
}

export function PublicAnamnesisPage({ firstName, token, patientId }: Props) {
  const [status, setStatus] = useState<'form' | 'submitting' | 'success' | 'error'>('form')
  const [errorMessage, setErrorMessage] = useState('')

  async function handleSubmit(data: Record<string, unknown>) {
    setStatus('submitting')
    try {
      const res = await fetch(`/api/anamnesis/token/${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Erro ao enviar')
      }
      setStatus('success')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro ao enviar')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="text-center py-16">
        <div className="rounded-full bg-sage/10 p-5 inline-flex mb-6">
          <CheckCircle2Icon className="h-10 w-10 text-sage" />
        </div>
        <h2 className="text-2xl font-medium text-charcoal">Obrigado, {firstName}!</h2>
        <p className="text-mid mt-2">Seus dados foram recebidos com sucesso.</p>
        <p className="text-mid text-sm mt-1">Você já pode fechar esta página.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="text-center mb-8">
        <h2 className="text-2xl font-medium text-charcoal">Olá, {firstName}!</h2>
        <p className="text-mid mt-1">Preencha o formulário abaixo antes da sua consulta.</p>
      </div>

      {status === 'error' && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 mb-6">
          <p className="text-sm text-red-700">{errorMessage}</p>
        </div>
      )}

      <AnamnesisForm
        patientId={patientId}
        publicMode
        onPublicSubmit={handleSubmit}
      />
    </div>
  )
}

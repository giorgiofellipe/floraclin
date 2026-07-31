'use client'

import { useState, type ComponentType } from 'react'
import { CrmDemo } from './feature-demos-crm'
import { FinancialDemo, CalendarDemo } from './feature-demos-business'
import {
  FaceDiagramDemo,
  BeforeAfterDemo,
  GuidedCaptureDemo,
} from './feature-demos-clinical'
import {
  GuidedFlowDemo,
  DigitalSignatureDemo,
  ConfirmationDemo,
  SelfServiceDemo,
} from './feature-demos-flow'

interface Entry {
  title: string
  group: string
  /** What the animation is meant to say, so a future edit can be judged against it. */
  story: string
  Demo: ComponentType
}

const ENTRIES: Entry[] = [
  {
    title: 'Diagrama Facial Interativo',
    group: 'Precisão Clínica Visual',
    story: 'Pontos entram com pop, cada um ganha produto e dose, resumo soma unidades e volume',
    Demo: FaceDiagramDemo,
  },
  {
    title: 'Antes e Depois com Alinhamento',
    group: 'Precisão Clínica Visual',
    story: 'Varredura, marcos oculares, guia desalinhada, snap de alinhamento e comparação',
    Demo: BeforeAfterDemo,
  },
  {
    title: 'Captura Guiada + Anotações',
    group: 'Precisão Clínica Visual',
    story: 'Guia de pose, alinhado, flash, foto, então seta, círculo e régua "12 mm"',
    Demo: GuidedCaptureDemo,
  },
  {
    title: 'Atendimento Guiado',
    group: 'Fluxo sem Atrito',
    story: 'Etapas completam em sequência, a linha é desenhada, fecha com "Atendimento concluído"',
    Demo: GuidedFlowDemo,
  },
  {
    title: 'Assinatura Digital pelo WhatsApp',
    group: 'Fluxo sem Atrito',
    story: 'Mensagem, toque no link, documento sobe, assinatura, selo verificado',
    Demo: DigitalSignatureDemo,
  },
  {
    title: 'Confirmação Automática',
    group: 'Fluxo sem Atrito',
    story: 'Conversa acumula com indicador de digitação, toque em "Confirmar" e ticks de leitura',
    Demo: ConfirmationDemo,
  },
  {
    title: 'Anamnese e Agendamento Self-service',
    group: 'Fluxo sem Atrito',
    story: 'Tela 1 escolhe horário, transição lateral, tela 2 preenche a anamnese',
    Demo: SelfServiceDemo,
  },
  {
    title: 'Financeiro Completo',
    group: 'Gestão do Negócio',
    story: 'Receita, comissões, despesas, líquido e trilha de parcelas com multa automática',
    Demo: FinancialDemo,
  },
  {
    title: 'CRM de Pacientes',
    group: 'Gestão do Negócio',
    story: 'Card avança de coluna com lift, viagem e assentamento, contadores atualizam',
    Demo: CrmDemo,
  },
  {
    title: 'Agenda com Google Calendar',
    group: 'Gestão do Negócio',
    story: 'Setas viajam nos dois sentidos, evento novo chega do Google e se solidifica',
    Demo: CalendarDemo,
  },
]

export function MotionLab() {
  // Bumping a key remounts the demo, which is exactly how the showcase replays
  // them when a tab activates. Replay here therefore matches production.
  const [globalKey, setGlobalKey] = useState(0)
  const [itemKeys, setItemKeys] = useState<Record<number, number>>({})

  const replayOne = (i: number) =>
    setItemKeys((prev) => ({ ...prev, [i]: (prev[i] ?? 0) + 1 }))

  const replayAll = () => {
    setGlobalKey((k) => k + 1)
    setItemKeys({})
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-[1200px] px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">Motion Lab</h1>
            <p className="text-xs text-neutral-500">
              Animações da seção Recursos, isoladas para revisão. Página interna, fora do site público.
            </p>
          </div>
          <button
            type="button"
            onClick={replayAll}
            className="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 transition-colors"
          >
            Reproduzir tudo
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-6 py-8 grid gap-6 md:grid-cols-2">
        {ENTRIES.map((entry, i) => {
          const key = globalKey * 1000 + (itemKeys[i] ?? 0)
          const Demo = entry.Demo
          return (
            <section key={entry.title}>
              <div className="flex items-baseline justify-between gap-4 mb-2">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.15em] text-neutral-400">
                    {entry.group}
                  </p>
                  <h2 className="text-base font-semibold text-neutral-900">{entry.title}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => replayOne(i)}
                  className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
                >
                  Reproduzir
                </button>
              </div>

              <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
                <div className="aspect-[16/10] p-4">
                  <Demo key={key} />
                </div>
              </div>

              <p className="mt-2 text-xs text-neutral-600">{entry.story}</p>
            </section>
          )
        })}
      </main>
    </div>
  )
}

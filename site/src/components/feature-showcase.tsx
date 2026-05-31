'use client'

import { useRef, useCallback, type ComponentType } from 'react'
import { FadeIn } from './fade-in'
import { useAutoCycle } from '@/hooks/use-auto-cycle'

function slugify(str: string) {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}
import {
  FaceDiagramDemo,
  BeforeAfterDemo,
  GuidedCaptureDemo,
  GuidedFlowDemo,
  DigitalSignatureDemo,
  SelfServiceDemo,
  FinancialDemo,
  PackagesDemo,
  CalendarDemo,
} from './feature-demos'

interface FeatureShowcaseProps {
  groups: {
    label: string
    features: {
      title: string
      description: string
      demo: ComponentType
    }[]
  }[]
}

const GROUP_BG = ['bg-cream', 'bg-petal/40', 'bg-cream']
const CYCLE_INTERVAL = 5000

const DEFAULT_GROUPS: FeatureShowcaseProps['groups'] = [
  {
    label: 'Precisão Clínica Visual',
    features: [
      {
        title: 'Diagrama Facial Interativo',
        description:
          'Mapeie cada ponto de aplicação no rosto do paciente. Produto, profundidade, quantidade e localização exata, tudo registrado visualmente e vinculado ao prontuário.',
        demo: FaceDiagramDemo,
      },
      {
        title: 'Antes e Depois que Convence',
        description:
          'O sistema alinha as fotos automaticamente para que a comparação seja justa. Seu paciente vê o resultado real, você documenta com precisão.',
        demo: BeforeAfterDemo,
      },
      {
        title: 'Captura Guiada + Anotações',
        description:
          'Guia de pose na câmera (frontal, perfil, oblíquo) com captura automática quando o rosto está alinhado e em foco. Anote com setas, círculos e régua de medição.',
        demo: GuidedCaptureDemo,
      },
    ],
  },
  {
    label: 'Fluxo sem Atrito',
    features: [
      {
        title: 'Atendimento Guiado Passo a Passo',
        description:
          'O sistema conduz o fluxo: anamnese, avaliação, planejamento, aprovação, execução, acompanhamento. Você só segue. Nenhuma etapa esquecida.',
        demo: GuidedFlowDemo,
      },
      {
        title: 'Assinatura Digital pelo WhatsApp',
        description:
          'Termos de consentimento e contratos assinados pelo paciente no celular, direto pelo link no WhatsApp. 100% seguro, sem papel, sem complicação.',
        demo: DigitalSignatureDemo,
      },
      {
        title: 'Anamnese e Agendamento Self-service',
        description:
          'O paciente agenda online e preenche a anamnese pelo celular antes da consulta. Sem cadastro, sem senha, sem ligar pra clínica.',
        demo: SelfServiceDemo,
      },
    ],
  },
  {
    label: 'Gestão do Negócio',
    features: [
      {
        title: 'Financeiro Completo',
        description:
          'Cobranças parceladas, despesas recorrentes, comissão por profissional, multa e juros automáticos, renegociação e estorno. Em breve: links de pagamento por PIX, boleto e cartão.',
        demo: FinancialDemo,
      },
      {
        title: 'Pacotes e Controle de Sessões',
        description:
          'Venda pacotes de procedimentos e acompanhe sessões realizadas vs. contratadas. Sem planilha, sem erro.',
        demo: PackagesDemo,
      },
      {
        title: 'Agenda com Google Calendar',
        description:
          'Visualização por profissional, agendamento online pelo paciente e sincronização bidirecional com Google Calendar. Sem conflito de horário.',
        demo: CalendarDemo,
      },
    ],
  },
]

export function FeatureShowcase({ groups = DEFAULT_GROUPS }: Partial<FeatureShowcaseProps>) {
  return (
    <section id="recursos" className="py-0">
      <div className="bg-cream pt-16 md:pt-32 pb-0">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="text-center mb-16 md:mb-20">
            <p className="section-label mb-4">Recursos</p>
            <h2 className="text-3xl md:text-[2.5rem] md:leading-tight max-w-2xl mx-auto">
              Feito para HOF. Não adaptado de outro sistema.
            </h2>
          </div>
        </div>
      </div>
      <div>
        {groups.map((group, groupIndex) => (
          <FeatureShowcaseGroup
            key={group.label}
            group={group}
            bgClass={GROUP_BG[groupIndex] ?? 'bg-cream'}
          />
        ))}
      </div>
    </section>
  )
}

function FeatureShowcaseGroup({
  group,
  bgClass,
}: {
  group: FeatureShowcaseProps['groups'][number]
  bgClass: string
}) {
  const { activeIndex, select, pause, resume, isPaused } = useAutoCycle({
    count: group.features.length,
    interval: CYCLE_INTERVAL,
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const groupSlug = slugify(group.label)

  const activeFeature = group.features[activeIndex]
  const DemoComponent = activeFeature.demo

  const handleBlur = useCallback(() => {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    blurTimeoutRef.current = setTimeout(() => {
      if (!containerRef.current?.contains(document.activeElement)) {
        resume()
      }
    }, 0)
  }, [resume])

  const handleFocus = useCallback(() => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current)
      blurTimeoutRef.current = null
    }
    pause()
  }, [pause])

  return (
    <div className={`${bgClass} py-12 md:py-16`}>
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="flex items-center justify-center gap-4 mb-8">
          <span className="h-px w-8 bg-sage/30" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sage px-3 py-1.5 bg-sage/8 rounded-full">
            {group.label}
          </p>
          <span className="h-px w-8 bg-sage/30" />
        </div>

        <FadeIn>
          <div
            ref={containerRef}
            className="bg-white rounded-2xl border border-sage/10 shadow-sm shadow-sage/5 overflow-hidden"
            onMouseEnter={pause}
            onMouseLeave={resume}
            onFocus={handleFocus}
            onBlur={handleBlur}
          >
            {/* ── Desktop: side tabs ── */}
            <div className="hidden md:flex">
              <div
                role="tablist"
                aria-label={group.label}
                className="w-[260px] shrink-0 border-r border-sage/10 py-4"
              >
                {group.features.map((feature, index) => {
                  const isActive = index === activeIndex
                  return (
                    <button
                      key={feature.title}
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`panel-${groupSlug}-${index}`}
                      id={`tab-${groupSlug}-${index}`}
                      onClick={() => select(index)}
                      className={`
                        w-full text-left px-6 py-4 transition-colors relative
                        ${isActive
                          ? 'bg-sage/10 border-l-[3px] border-l-sage'
                          : 'border-l-[3px] border-l-transparent hover:bg-sage/5'
                        }
                      `}
                    >
                      <h3 className={`text-lg mb-1 ${isActive ? 'text-forest' : 'text-charcoal/50'}`}>
                        {feature.title}
                      </h3>
                      <p className={`text-sm leading-relaxed ${isActive ? 'text-charcoal/70' : 'text-charcoal/40'}`}>
                        {feature.description}
                      </p>
                      {isActive && (
                        <div className="mt-3 h-1 rounded-full bg-sage/10 overflow-hidden">
                          <div
                            data-timer-bar
                            key={activeIndex}
                            className="h-full rounded-full bg-sage showcase-timer-bar"
                            style={{
                              animationDuration: `${CYCLE_INTERVAL}ms`,
                              animationPlayState: isPaused ? 'paused' : 'running',
                            }}
                          />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>

              <div
                role="tabpanel"
                id={`panel-${groupSlug}-${activeIndex}`}
                aria-labelledby={`tab-${groupSlug}-${activeIndex}`}
                className="flex-1 flex items-center justify-center p-8"
              >
                <div className="w-full aspect-[16/10]">
                  <DemoComponent key={activeIndex} />
                </div>
              </div>
            </div>

            {/* ── Mobile: accordion ── */}
            <div className="md:hidden py-2">
              {group.features.map((feature, index) => {
                const isActive = index === activeIndex
                const FeatureDemo = feature.demo
                return (
                  <div key={feature.title}>
                    <button
                      onClick={() => select(index)}
                      className={`
                        w-full text-left px-5 py-3 transition-colors
                        ${isActive ? 'bg-sage/10' : 'opacity-50 hover:bg-sage/5'}
                        ${index > 0 ? 'border-t border-sage/10' : ''}
                      `}
                    >
                      <h3 className={`text-base ${isActive ? 'text-forest' : 'text-charcoal/50'}`}>
                        {feature.title}
                      </h3>
                    </button>
                    {isActive && (
                      <div className="px-5 pb-4">
                        <div className="aspect-[16/10] mb-3 rounded-lg overflow-hidden bg-cream/50">
                          <FeatureDemo key={activeIndex} />
                        </div>
                        <p className="text-sm text-charcoal/70 leading-relaxed mb-3">
                          {feature.description}
                        </p>
                        <div className="h-1 rounded-full bg-sage/10 overflow-hidden">
                          <div
                            data-timer-bar
                            key={activeIndex}
                            className="h-full rounded-full bg-sage showcase-timer-bar"
                            style={{
                              animationDuration: `${CYCLE_INTERVAL}ms`,
                              animationPlayState: isPaused ? 'paused' : 'running',
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </FadeIn>
      </div>
    </div>
  )
}

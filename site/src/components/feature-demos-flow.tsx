/**
 * "Fluxo sem Atrito" demos. Same motion language as feature-demos-crm.
 *
 * Three rules every demo follows:
 *   1. Play once and hold. The showcase remounts each demo when its tab
 *      activates (key={activeIndex}) and cycles every 6s, so the story runs
 *      inside ~4.2s and keeps its final frame. No infinite loop, no reset flash.
 *   2. Easing carries intent: --e-out for entrances, --e-pop for payoffs,
 *      --e-io for travel. Never ease-in-out for everything.
 *   3. Compositor-friendly only: transform, opacity, filter. Never animate SVG
 *      geometry attributes like r or width.
 *
 * Stroke draw-ons use pathLength={100} so stroke-dasharray/-dashoffset are
 * exact percentages regardless of the real path length.
 */

// ─── 1. Atendimento guiado passo a passo ────────────────────────────

const FLOW_STEPS = ['Anamnese', 'Avaliação', 'Planejamento', 'Aprovação', 'Execução']

export function GuidedFlowDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes gf-enter { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes gf-pop   { 0% { transform: scale(1); } 45% { transform: scale(1.16); } 100% { transform: scale(1); } }
        @keyframes gf-fill  { from { opacity: 0; transform: scale(0.55); } to { opacity: 1; transform: scale(1); } }
        @keyframes gf-draw  { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
        @keyframes gf-ring  { from { opacity: 0.55; transform: scale(1); } to { opacity: 0; transform: scale(2); } }
        @keyframes gf-chip  { from { opacity: 0; transform: translateY(10px) scale(0.9); } to { opacity: 1; transform: translateY(0) scale(1); } }

        /* Nodes land left→right, 80ms apart. */
        .gf-enter { opacity: 0; animation: gf-enter 0.45s var(--e-out) forwards; }
        .gf-e1 { animation-delay: 0s; }    .gf-e2 { animation-delay: 0.08s; }
        .gf-e3 { animation-delay: 0.16s; } .gf-e4 { animation-delay: 0.24s; }
        .gf-e5 { animation-delay: 0.32s; }

        /* Then each step completes in turn: pop → fill → check → ring → connector. */
        .gf-pop { animation: gf-pop 0.44s var(--e-pop) forwards; transform-box: fill-box; transform-origin: center; }
        .gf-p1 { animation-delay: 0.80s; } .gf-p2 { animation-delay: 1.35s; }
        .gf-p3 { animation-delay: 1.90s; } .gf-p4 { animation-delay: 2.45s; }
        .gf-p5 { animation-delay: 3.00s; }

        .gf-fill { opacity: 0; animation: gf-fill 0.34s var(--e-out) forwards; transform-box: fill-box; transform-origin: center; }
        .gf-f1 { animation-delay: 0.80s; } .gf-f2 { animation-delay: 1.35s; }
        .gf-f3 { animation-delay: 1.90s; } .gf-f4 { animation-delay: 2.45s; }
        .gf-f5 { animation-delay: 3.00s; }

        .gf-check { stroke-dasharray: 100; stroke-dashoffset: 100; animation: gf-draw 0.3s var(--e-out) forwards; }
        .gf-k1 { animation-delay: 0.92s; } .gf-k2 { animation-delay: 1.47s; }
        .gf-k3 { animation-delay: 2.02s; } .gf-k4 { animation-delay: 2.57s; }
        .gf-k5 { animation-delay: 3.12s; }

        /* One-shot pulse at completion; holds at opacity 0, so it never re-fires. */
        .gf-ring { opacity: 0; animation: gf-ring 0.52s var(--e-out) forwards; transform-box: fill-box; transform-origin: center; }
        .gf-r1 { animation-delay: 0.98s; } .gf-r2 { animation-delay: 1.53s; }
        .gf-r3 { animation-delay: 2.08s; } .gf-r4 { animation-delay: 2.63s; }
        .gf-r5 { animation-delay: 3.18s; }

        .gf-conn { stroke-dasharray: 100; stroke-dashoffset: 100; animation: gf-draw 0.32s var(--e-io) forwards; }
        .gf-x1 { animation-delay: 1.10s; } .gf-x2 { animation-delay: 1.65s; }
        .gf-x3 { animation-delay: 2.20s; } .gf-x4 { animation-delay: 2.75s; }

        .gf-chip { opacity: 0; animation: gf-chip 0.46s var(--e-pop) 3.60s forwards; transform-box: fill-box; transform-origin: center; }

        @media (prefers-reduced-motion: reduce) {
          .gf-enter, .gf-pop, .gf-fill, .gf-check, .gf-ring, .gf-conn, .gf-chip { animation: none; }
          .gf-enter, .gf-fill, .gf-chip { opacity: 1; transform: none; }
          .gf-check, .gf-conn { stroke-dashoffset: 0; }
          .gf-ring { opacity: 0; }
        }
      `}</style>

      <text x="20" y="34" fontSize="11" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="600">Atendimento guiado</text>

      {FLOW_STEPS.map((label, i) => {
        const cx = 60 + i * 75
        return (
          <g key={label}>
            {/* Track sits under the connector so the draw-on reads as progress. */}
            {i < 4 && <path d={`M${cx + 16} 126 L${cx + 59} 126`} stroke="#E8D5C8" strokeWidth="2" strokeLinecap="round" />}
            {i < 4 && (
              <path
                className={`gf-conn gf-x${i + 1}`}
                d={`M${cx + 16} 126 L${cx + 59} 126`}
                pathLength={100}
                stroke="#4A6B52"
                strokeWidth="2"
                strokeLinecap="round"
              />
            )}
            <g className={`gf-enter gf-e${i + 1}`}>
              <g className={`gf-pop gf-p${i + 1}`}>
                <circle cx={cx} cy={126} r="16" fill="white" stroke="#8FB49A" strokeWidth="1.5" />
                <circle className={`gf-fill gf-f${i + 1}`} cx={cx} cy={126} r="16" fill="#4A6B52" />
                <path
                  className={`gf-check gf-k${i + 1}`}
                  d={`M${cx - 6} 126 L${cx - 1.5} 131 L${cx + 6.5} 121`}
                  pathLength={100}
                  stroke="white"
                  strokeWidth="2.4"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
              <text x={cx} y={160} textAnchor="middle" fontSize="8.5" fill="#4A6B52" fontFamily="sans-serif">
                {label}
              </text>
            </g>
            <circle className={`gf-ring gf-r${i + 1}`} cx={cx} cy={126} r="16" fill="none" stroke="#8FB49A" strokeWidth="2" />
          </g>
        )
      })}

      <g className="gf-chip">
        <rect x="118" y="206" width="164" height="28" rx="14" fill="#4A6B52" fillOpacity="0.12" />
        <circle cx="138" cy="220" r="8" fill="#4A6B52" />
        <path d="M134.5 220 L137 222.5 L141.5 217" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text x="152" y="223.5" fontSize="9" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="600">
          Atendimento concluído
        </text>
      </g>
    </svg>
  )
}

// ─── 2. Assinatura digital pelo WhatsApp ────────────────────────────

export function DigitalSignatureDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes ds-phone  { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
        @keyframes ds-msg    { from { opacity: 0; transform: translateY(-12px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes ds-ripple { from { opacity: 0.5; transform: scale(1); } to { opacity: 0; transform: scale(4.2); } }
        @keyframes ds-doc    { from { opacity: 0; transform: translateY(110px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ds-sign   { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
        @keyframes ds-badge  { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
        @keyframes ds-verify { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }

        .ds-phone  { opacity: 0; animation: ds-phone 0.5s var(--e-out) forwards; transform-box: fill-box; transform-origin: center; }
        .ds-msg    { opacity: 0; animation: ds-msg 0.5s var(--e-out) 0.30s forwards; transform-box: fill-box; transform-origin: center; }
        .ds-ripple { opacity: 0; animation: ds-ripple 0.55s var(--e-out) 1.00s forwards; transform-box: fill-box; transform-origin: center; }
        .ds-doc    { opacity: 0; animation: ds-doc 0.6s var(--e-out) 1.30s forwards; }
        /* --e-io so the scrawl speeds up mid-stroke instead of drawing linearly. */
        .ds-sign   { stroke-dasharray: 100; stroke-dashoffset: 100; animation: ds-sign 1.2s var(--e-io) 2.00s forwards; }
        .ds-badge  { opacity: 0; animation: ds-badge 0.45s var(--e-pop) 3.35s forwards; transform-box: fill-box; transform-origin: center; }
        .ds-verify { opacity: 0; animation: ds-verify 0.4s var(--e-out) 3.70s forwards; }

        @media (prefers-reduced-motion: reduce) {
          .ds-phone, .ds-msg, .ds-ripple, .ds-doc, .ds-sign, .ds-badge, .ds-verify { animation: none; }
          .ds-phone, .ds-msg, .ds-doc, .ds-badge, .ds-verify { opacity: 1; transform: none; }
          .ds-sign { stroke-dashoffset: 0; }
          .ds-ripple { opacity: 0; }
        }
      `}</style>

      <defs>
        <clipPath id="ds-screen-clip">
          <rect x="122" y="32" width="156" height="216" rx="6" />
        </clipPath>
      </defs>

      <g className="ds-phone">
        <rect x="112" y="14" width="176" height="252" rx="20" fill="#FAF7F3" stroke="#1C2B1E" strokeWidth="2" />
        <rect x="122" y="32" width="156" height="216" rx="6" fill="white" stroke="#E8D5C8" strokeWidth="0.5" />
      </g>

      <g clipPath="url(#ds-screen-clip)">
        {/* The WhatsApp beat the old demo was missing: the term arrives as a message. */}
        <g className="ds-msg">
          <rect x="130" y="44" width="140" height="58" rx="9" fill="#4A6B52" fillOpacity="0.1" />
          <text x="138" y="57" fontSize="7" fill="#4A6B52" fontFamily="sans-serif" fontWeight="700">FloraClin</text>
          <text x="138" y="69" fontSize="7.5" fill="#1C2B1E" fontFamily="sans-serif">Seu termo está pronto</text>
          <text x="138" y="79" fontSize="7.5" fill="#1C2B1E" fontFamily="sans-serif">para assinatura</text>
          <rect x="138" y="84" width="84" height="14" rx="7" fill="white" stroke="#8FB49A" strokeWidth="1" />
          <text x="180" y="93.5" textAnchor="middle" fontSize="6.5" fill="#4A6B52" fontFamily="sans-serif" fontWeight="600">
            Abrir documento
          </text>
        </g>
        <circle className="ds-ripple" cx="180" cy="91" r="7" fill="#4A6B52" />

        <g className="ds-doc">
          <rect x="130" y="110" width="136" height="118" rx="8" fill="white" stroke="#E8D5C8" strokeWidth="1" />
          <rect x="140" y="124" width="108" height="5" rx="2.5" fill="#E8D5C8" />
          <rect x="140" y="136" width="96" height="5" rx="2.5" fill="#E8D5C8" />
          <rect x="140" y="148" width="104" height="5" rx="2.5" fill="#E8D5C8" />
          <rect x="140" y="160" width="82" height="5" rx="2.5" fill="#E8D5C8" />
          <path
            className="ds-sign"
            d="M144 190 Q150 168 158 188 Q164 202 172 180 Q178 164 186 186 Q191 198 198 178 Q204 162 212 184 Q217 196 224 182 Q231 170 238 186 Q243 194 250 184"
            pathLength={100}
            stroke="#1C2B1E"
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1="140" y1="196" x2="256" y2="196" stroke="#8FB49A" strokeWidth="1" strokeDasharray="3 2" />
          <text x="140" y="207" fontSize="7" fill="#7A7A7A" fontFamily="sans-serif">Assinatura</text>
          <g className="ds-badge">
            <rect x="196" y="203" width="62" height="17" rx="8.5" fill="#4A6B52" />
            <path d="M205 211.5 L208 214.5 L213 208" stroke="white" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <text x="232" y="214.5" textAnchor="middle" fontSize="7" fill="white" fontFamily="sans-serif" fontWeight="600">
              Assinado
            </text>
          </g>
        </g>

        <text className="ds-verify" x="198" y="240" textAnchor="middle" fontSize="6.5" fill="#7A7A7A" fontFamily="sans-serif">
          Assinado em 31/07 · verificado
        </text>
      </g>
    </svg>
  )
}

// ─── 3. Confirmação automática de consultas ─────────────────────────

export function ConfirmationDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes conf-phone  { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
        @keyframes conf-inL    { from { opacity: 0; transform: translateX(-16px) scale(0.94); } to { opacity: 1; transform: translateX(0) scale(1); } }
        @keyframes conf-inR    { from { opacity: 0; transform: translateX(16px) scale(0.94); } to { opacity: 1; transform: translateX(0) scale(1); } }
        @keyframes conf-ripple { from { opacity: 0.5; transform: scale(1); } to { opacity: 0; transform: scale(4.4); } }
        @keyframes conf-toast  { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes conf-pop    { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
        /* Master timelines (4.2s) for the two elements that must disappear on cue. */
        @keyframes conf-typing {
          0%, 40%   { opacity: 0; transform: translateY(6px); }
          44%       { opacity: 1; transform: translateY(0); }
          62%       { opacity: 1; transform: translateY(0); }
          65%, 100% { opacity: 0; transform: translateY(0); }
        }
        @keyframes conf-tickOld { 0%, 68% { opacity: 0; } 71%, 76% { opacity: 1; } 79%, 100% { opacity: 0; } }
        @keyframes conf-tickNew { 0%, 76% { opacity: 0; } 80%, 100% { opacity: 1; } }
        @keyframes conf-dot     { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-3.5px); } }

        .conf-phone { opacity: 0; animation: conf-phone 0.5s var(--e-out) forwards; transform-box: fill-box; transform-origin: center; }
        .conf-head  { opacity: 0; animation: conf-inL 0.4s var(--e-out) 0.15s forwards; transform-box: fill-box; transform-origin: center; }
        .conf-b1    { opacity: 0; animation: conf-inL 0.5s var(--e-out) 0.40s forwards; transform-box: fill-box; transform-origin: left center; }
        .conf-b2    { opacity: 0; animation: conf-inL 0.5s var(--e-out) 1.00s forwards; transform-box: fill-box; transform-origin: left center; }
        .conf-reply { opacity: 0; animation: conf-inR 0.5s var(--e-out) 2.70s forwards; transform-box: fill-box; transform-origin: right center; }
        .conf-ripple{ opacity: 0; animation: conf-ripple 0.55s var(--e-out) 2.40s forwards; transform-box: fill-box; transform-origin: center; }

        .conf-typing { opacity: 0; animation: conf-typing 4.2s linear forwards; }
        /* The one looping element in the set: a typing indicator is genuinely live. */
        .conf-dot { animation: conf-dot 0.28s var(--e-io) 3; }
        .conf-d1 { animation-delay: 1.82s; } .conf-d2 { animation-delay: 1.90s; } .conf-d3 { animation-delay: 1.98s; }

        .conf-tickOld { opacity: 0; animation: conf-tickOld 4.2s linear forwards; }
        .conf-tickNew { opacity: 0; animation: conf-tickNew 4.2s linear forwards; }

        .conf-toast { opacity: 0; animation: conf-toast 0.46s var(--e-out) 3.60s forwards; }
        .conf-tcheck { opacity: 0; animation: conf-pop 0.4s var(--e-pop) 3.72s forwards; transform-box: fill-box; transform-origin: center; }

        @media (prefers-reduced-motion: reduce) {
          .conf-phone, .conf-head, .conf-b1, .conf-b2, .conf-reply, .conf-ripple,
          .conf-typing, .conf-dot, .conf-tickOld, .conf-tickNew, .conf-toast, .conf-tcheck { animation: none; }
          .conf-phone, .conf-head, .conf-b1, .conf-b2, .conf-reply, .conf-toast, .conf-tcheck, .conf-tickNew { opacity: 1; transform: none; }
          .conf-ripple, .conf-typing, .conf-tickOld { opacity: 0; }
        }
      `}</style>

      <g className="conf-phone">
        <rect x="112" y="14" width="176" height="252" rx="20" fill="#FAF7F3" stroke="#1C2B1E" strokeWidth="2" />
        <rect x="122" y="32" width="156" height="216" rx="6" fill="white" stroke="#E8D5C8" strokeWidth="0.5" />
      </g>

      <g className="conf-head">
        <rect x="122" y="32" width="156" height="26" rx="6" fill="#4A6B52" />
        <circle cx="136" cy="45" r="8" fill="white" fillOpacity="0.25" />
        <text x="136" y="48" textAnchor="middle" fontSize="8" fill="white" fontFamily="sans-serif" fontWeight="700">F</text>
        <text x="150" y="48" fontSize="8" fill="white" fontFamily="sans-serif" fontWeight="600">FloraClin</text>
      </g>

      {/* Messages accumulate and stay. Nothing in a real chat fades back out. */}
      <g className="conf-b1">
        <rect x="128" y="66" width="124" height="34" rx="9" fill="#4A6B52" fillOpacity="0.1" />
        <text x="136" y="81" fontSize="7" fill="#1C2B1E" fontFamily="sans-serif">Olá Maria! Lembrete:</text>
        <text x="136" y="92" fontSize="7" fill="#1C2B1E" fontFamily="sans-serif">consulta amanhã às 14h</text>
      </g>

      <g className="conf-b2">
        <rect x="128" y="106" width="124" height="44" rx="9" fill="#4A6B52" fillOpacity="0.1" />
        <text x="136" y="120" fontSize="7.5" fill="#1C2B1E" fontFamily="sans-serif">Podemos confirmar?</text>
        <rect x="135" y="126" width="52" height="16" rx="8" fill="white" stroke="#8FB49A" strokeWidth="1" />
        <text x="161" y="136.5" textAnchor="middle" fontSize="6.5" fill="#4A6B52" fontFamily="sans-serif" fontWeight="600">Confirmar</text>
        <rect x="192" y="126" width="52" height="16" rx="8" fill="white" stroke="#E8D5C8" strokeWidth="1" />
        <text x="218" y="136.5" textAnchor="middle" fontSize="6.5" fill="#7A7A7A" fontFamily="sans-serif">Reagendar</text>
      </g>

      <g className="conf-typing">
        <rect x="196" y="158" width="52" height="22" rx="9" fill="#8FB49A" fillOpacity="0.28" />
        <circle className="conf-dot conf-d1" cx="210" cy="169" r="2.8" fill="#4A6B52" />
        <circle className="conf-dot conf-d2" cx="222" cy="169" r="2.8" fill="#4A6B52" />
        <circle className="conf-dot conf-d3" cx="234" cy="169" r="2.8" fill="#4A6B52" />
      </g>

      <circle className="conf-ripple" cx="161" cy="134" r="7" fill="#4A6B52" />

      <g className="conf-reply">
        <rect x="176" y="158" width="76" height="26" rx="9" fill="#8FB49A" fillOpacity="0.35" />
        <text x="214" y="175" textAnchor="middle" fontSize="7.5" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="600">
          Confirmado ✓
        </text>
      </g>

      {/* Read receipt: the delivery ticks go from grey to sage. */}
      <path
        className="conf-tickOld"
        d="M232 190 L235 193 L240 187 M239 190 L242 193 L247 187"
        stroke="#7A7A7A"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="conf-tickNew"
        d="M232 190 L235 193 L240 187 M239 190 L242 193 L247 187"
        stroke="#4A6B52"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <g className="conf-toast">
        <rect x="126" y="212" width="148" height="28" rx="14" fill="#1C2B1E" />
        <g className="conf-tcheck">
          <circle cx="142" cy="226" r="8" fill="#8FB49A" />
          <path d="M138.5 226 L141 228.5 L145.5 223" stroke="#1C2B1E" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <text x="156" y="229" fontSize="6.8" fill="white" fontFamily="sans-serif" fontWeight="600">
          Consulta confirmada na agenda
        </text>
      </g>
    </svg>
  )
}

// ─── 4. Anamnese e agendamento self-service ─────────────────────────

const SLOTS = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00']
const DAYS = [
  { w: 'Seg', d: '27' },
  { w: 'Ter', d: '28' },
  { w: 'Qua', d: '29' },
  { w: 'Qui', d: '30' },
  { w: 'Sex', d: '31' },
]
const FIELDS = ['Nome completo', 'Data de nascimento', 'Alergias', 'Medicamentos em uso']

/** Screen 2 is drawn one screen-width to the right; the track slides both at once. */
const S2 = 168

export function SelfServiceDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes ss-phone  { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
        @keyframes ss-enter  { from { opacity: 0; transform: translateY(8px) scale(0.94); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes ss-ripple { from { opacity: 0.5; transform: scale(1); } to { opacity: 0; transform: scale(4); } }
        @keyframes ss-fade   { from { opacity: 0; } to { opacity: 1; } }
        @keyframes ss-unfade { from { opacity: 1; } to { opacity: 0; } }
        @keyframes ss-slide  { from { transform: translateX(0); } to { transform: translateX(-${S2}px); } }
        @keyframes ss-bar    { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes ss-pop    { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }

        .ss-phone { opacity: 0; animation: ss-phone 0.5s var(--e-out) forwards; transform-box: fill-box; transform-origin: center; }
        .ss-head  { opacity: 0; animation: ss-fade 0.4s var(--e-out) 0.30s forwards; }

        .ss-enter { opacity: 0; animation: ss-enter 0.4s var(--e-out) forwards; transform-box: fill-box; transform-origin: center; }
        .ss-y1 { animation-delay: 0.34s; } .ss-y2 { animation-delay: 0.41s; }
        .ss-y3 { animation-delay: 0.48s; } .ss-y4 { animation-delay: 0.55s; }
        .ss-y5 { animation-delay: 0.62s; }
        .ss-t1 { animation-delay: 0.55s; } .ss-t2 { animation-delay: 0.62s; }
        .ss-t3 { animation-delay: 0.69s; } .ss-t4 { animation-delay: 0.76s; }
        .ss-t5 { animation-delay: 0.83s; } .ss-t6 { animation-delay: 0.90s; }

        .ss-tap1 { opacity: 0; animation: ss-ripple 0.55s var(--e-out) 1.00s forwards; transform-box: fill-box; transform-origin: center; }
        .ss-pick { opacity: 0; animation: ss-fade 0.35s var(--e-out) 1.05s forwards; }
        .ss-drop { animation: ss-unfade 0.35s var(--e-out) 1.05s forwards; }

        /* Wizard step change: screen 1 exits left as screen 2 enters from the right. */
        .ss-track { animation: ss-slide 0.55s var(--e-io) 1.50s forwards; }

        .ss-bar { transform-box: fill-box; transform-origin: left center; transform: scaleX(0); animation: ss-bar 0.34s var(--e-out) forwards; }
        .ss-g1 { animation-delay: 1.90s; } .ss-g2 { animation-delay: 2.20s; }
        .ss-g3 { animation-delay: 2.50s; } .ss-g4 { animation-delay: 2.80s; }

        .ss-ok { opacity: 0; animation: ss-pop 0.3s var(--e-pop) forwards; transform-box: fill-box; transform-origin: center; }
        .ss-o1 { animation-delay: 2.18s; } .ss-o2 { animation-delay: 2.48s; }
        .ss-o3 { animation-delay: 2.78s; } .ss-o4 { animation-delay: 3.08s; }

        .ss-send  { opacity: 0; animation: ss-fade 0.35s var(--e-out) 3.30s forwards; }
        .ss-sendOff { animation: ss-unfade 0.35s var(--e-out) 3.30s forwards; }
        .ss-tap2  { opacity: 0; animation: ss-ripple 0.55s var(--e-out) 3.30s forwards; transform-box: fill-box; transform-origin: center; }
        .ss-done  { opacity: 0; animation: ss-pop 0.45s var(--e-pop) 3.60s forwards; transform-box: fill-box; transform-origin: center; }

        @media (prefers-reduced-motion: reduce) {
          .ss-phone, .ss-head, .ss-enter, .ss-tap1, .ss-pick, .ss-drop, .ss-track,
          .ss-bar, .ss-ok, .ss-send, .ss-sendOff, .ss-tap2, .ss-done { animation: none; }
          .ss-phone, .ss-head, .ss-enter, .ss-pick, .ss-ok, .ss-send, .ss-done { opacity: 1; transform: none; }
          .ss-track { transform: translateX(-${S2}px); }
          .ss-bar { transform: scaleX(1); }
          .ss-tap1, .ss-tap2, .ss-drop, .ss-sendOff { opacity: 0; }
        }
      `}</style>

      <defs>
        <clipPath id="ss-screen-clip">
          <rect x="122" y="32" width="156" height="216" rx="6" />
        </clipPath>
      </defs>

      <g className="ss-phone">
        <rect x="112" y="14" width="176" height="252" rx="20" fill="#FAF7F3" stroke="#1C2B1E" strokeWidth="2" />
        <rect x="122" y="32" width="156" height="216" rx="6" fill="white" stroke="#E8D5C8" strokeWidth="0.5" />
      </g>

      <g clipPath="url(#ss-screen-clip)">
        <g className="ss-track">
          {/* ── Screen 1: agendamento ── */}
          <g className="ss-head">
            <text x="200" y="52" textAnchor="middle" fontSize="9.5" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="600">
              Escolha um horário
            </text>
            <text x="200" y="66" textAnchor="middle" fontSize="7" fill="#7A7A7A" fontFamily="sans-serif">
              Julho 2026
            </text>
          </g>

          {DAYS.map((day, i) => {
            const x = 127 + i * 30
            const active = i === 4
            return (
              <g key={day.d} className={`ss-enter ss-y${i + 1}`}>
                <rect x={x} y={72} width="26" height="30" rx="6" fill={active ? '#4A6B52' : 'white'} stroke={active ? '#4A6B52' : '#E8D5C8'} strokeWidth="1" />
                <text x={x + 13} y={84} textAnchor="middle" fontSize="6" fill={active ? 'white' : '#7A7A7A'} fontFamily="sans-serif">
                  {day.w}
                </text>
                <text x={x + 13} y={95} textAnchor="middle" fontSize="9" fill={active ? 'white' : '#2A2A2A'} fontFamily="sans-serif" fontWeight="600">
                  {day.d}
                </text>
              </g>
            )
          })}

          {SLOTS.map((slot, i) => {
            const x = 123 + (i % 3) * 54
            const y = 126 + Math.floor(i / 3) * 34
            const picked = slot === '14:00'
            return (
              <g key={slot} className={`ss-enter ss-t${i + 1}`}>
                <rect x={x} y={y} width="46" height="26" rx="7" fill="white" stroke="#E8D5C8" strokeWidth="1" />
                {/* Picked slot: sage panel and white label cross-fade over the default. */}
                {picked && <rect className="ss-pick" x={x} y={y} width="46" height="26" rx="7" fill="#4A6B52" />}
                <text
                  className={picked ? 'ss-drop' : undefined}
                  x={x + 23}
                  y={y + 17}
                  textAnchor="middle"
                  fontSize="8"
                  fill="#2A2A2A"
                  fontFamily="sans-serif"
                >
                  {slot}
                </text>
                {picked && (
                  <text className="ss-pick" x={x + 23} y={y + 17} textAnchor="middle" fontSize="8" fill="white" fontFamily="sans-serif" fontWeight="600">
                    {slot}
                  </text>
                )}
              </g>
            )
          })}

          <circle className="ss-tap1" cx="146" cy="173" r="8" fill="#4A6B52" />

          {/* ── Screen 2: anamnese ── */}
          <text x={200 + S2} y="52" textAnchor="middle" fontSize="9.5" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="600">
            Anamnese
          </text>

          {FIELDS.map((label, i) => {
            const y = 66 + i * 34
            return (
              <g key={label}>
                <text x={131 + S2} y={y + 8} fontSize="6.5" fill="#7A7A7A" fontFamily="sans-serif">
                  {label}
                </text>
                <rect x={131 + S2} y={y + 12} width="116" height="8" rx="4" fill="#E8D5C8" />
                <rect className={`ss-bar ss-g${i + 1}`} x={131 + S2} y={y + 12} width="116" height="8" rx="4" fill="#4A6B52" fillOpacity="0.55" />
                <g className={`ss-ok ss-o${i + 1}`}>
                  <circle cx={258 + S2} cy={y + 16} r="6" fill="#4A6B52" />
                  <path
                    d={`M${255.5 + S2} ${y + 16} L${257.5 + S2} ${y + 18.5} L${261 + S2} ${y + 13.5}`}
                    stroke="white"
                    strokeWidth="1.4"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              </g>
            )
          })}

          <rect x={131 + S2} y="196" width="116" height="26" rx="8" fill="#E8D5C8" />
          <rect className="ss-send" x={131 + S2} y="196" width="116" height="26" rx="8" fill="#4A6B52" />
          <text className="ss-sendOff" x={189 + S2} y="212.5" textAnchor="middle" fontSize="9" fill="#7A7A7A" fontFamily="sans-serif" fontWeight="600">
            Enviar
          </text>
          <text className="ss-send" x={189 + S2} y="212.5" textAnchor="middle" fontSize="9" fill="white" fontFamily="sans-serif" fontWeight="600">
            Enviar
          </text>
          <circle className="ss-tap2" cx={189 + S2} cy="209" r="10" fill="#4A6B52" />

          <g className="ss-done">
            <circle cx={172 + S2} cy="235" r="8" fill="#4A6B52" />
            <path
              d={`M${168.5 + S2} 235 L${171 + S2} 237.5 L${175.5 + S2} 232`}
              stroke="white"
              strokeWidth="1.8"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text x={186 + S2} y="238.5" fontSize="8.5" fill="#4A6B52" fontFamily="sans-serif" fontWeight="600">
              Recebido
            </text>
          </g>
        </g>
      </g>
    </svg>
  )
}

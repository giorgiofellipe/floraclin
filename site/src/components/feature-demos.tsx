export function FaceDiagramDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes fd-dot { 0%, 10% { r: 0; opacity: 0; } 20% { r: 5; opacity: 1; } 75% { r: 5; opacity: 1; } 85%, 100% { r: 0; opacity: 0; } }
        @keyframes fd-label { 0%, 15% { opacity: 0; } 30% { opacity: 1; } 75% { opacity: 1; } 85%, 100% { opacity: 0; } }
        .fd-dot { animation: fd-dot 4s ease-in-out infinite; }
        .fd-label { animation: fd-label 4s ease-in-out infinite; font-size: 10px; fill: #4A6B52; font-family: sans-serif; }
        .fd-d1 { animation-delay: 0s; } .fd-l1 { animation-delay: 0.1s; }
        .fd-d2 { animation-delay: 0.5s; } .fd-l2 { animation-delay: 0.6s; }
        .fd-d3 { animation-delay: 1.0s; } .fd-l3 { animation-delay: 1.1s; }
        .fd-d4 { animation-delay: 1.5s; } .fd-l4 { animation-delay: 1.6s; }
        .fd-d5 { animation-delay: 0.7s; } .fd-l5 { animation-delay: 0.8s; }
        @media (prefers-reduced-motion: reduce) { .fd-dot, .fd-label { animation: none; opacity: 1; r: 5; } }
      `}</style>
      <ellipse cx="200" cy="148" rx="72" ry="96" stroke="#1C2B1E" strokeWidth="2" fill="#FAF7F3" />
      <ellipse cx="178" cy="128" rx="12" ry="6" stroke="#1C2B1E" strokeWidth="1.2" fill="none" />
      <ellipse cx="222" cy="128" rx="12" ry="6" stroke="#1C2B1E" strokeWidth="1.2" fill="none" />
      <path d="M200 138 L194 160 Q200 164 206 160 Z" stroke="#1C2B1E" strokeWidth="1" fill="none" />
      <path d="M186 180 Q200 192 214 180" stroke="#1C2B1E" strokeWidth="1.2" fill="none" />
      <circle className="fd-dot fd-d1" cx="200" cy="80" fill="#4A6B52" />
      <text className="fd-label fd-l1" x="214" y="84">Testa</text>
      <circle className="fd-dot fd-d2" cx="158" cy="148" fill="#4A6B52" />
      <text className="fd-label fd-l2" x="128" y="152">Bochecha</text>
      <circle className="fd-dot fd-d5" cx="242" cy="148" fill="#4A6B52" />
      <text className="fd-label fd-l5" x="250" y="152">Bochecha</text>
      <circle className="fd-dot fd-d3" cx="175" cy="200" fill="#4A6B52" />
      <text className="fd-label fd-l3" x="140" y="216">Mandíbula</text>
      <circle className="fd-dot fd-d4" cx="200" cy="184" fill="#4A6B52" />
      <text className="fd-label fd-l4" x="214" y="188">Lábios</text>
    </svg>
  )
}

export function BeforeAfterDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes ba-slide-l { 0% { transform: translateX(-30px); } 30%, 65% { transform: translateX(0); } 85%, 100% { transform: translateX(-30px); } }
        @keyframes ba-slide-r { 0% { transform: translateX(30px); } 30%, 65% { transform: translateX(0); } 85%, 100% { transform: translateX(30px); } }
        @keyframes ba-grid { 0%, 35% { opacity: 0; } 45%, 60% { opacity: 1; } 75%, 100% { opacity: 0; } }
        @keyframes ba-lock { 0%, 50% { opacity: 0; transform: scale(0.5); } 58%, 65% { opacity: 1; transform: scale(1); } 60%, 63% { transform: scale(1.15); } 75%, 100% { opacity: 0; transform: scale(0.5); } }
        .ba-left { animation: ba-slide-l 4s ease-in-out infinite; }
        .ba-right { animation: ba-slide-r 4s ease-in-out infinite; }
        .ba-grid { animation: ba-grid 4s ease-in-out infinite; }
        .ba-lock { animation: ba-lock 4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .ba-left, .ba-right, .ba-grid, .ba-lock { animation: none; opacity: 1; transform: none; } }
      `}</style>
      <g className="ba-left">
        <rect x="40" y="50" width="130" height="170" rx="8" stroke="#1C2B1E" strokeWidth="2" fill="#FAF7F3" />
        <ellipse cx="105" cy="120" rx="28" ry="38" stroke="#8FB49A" strokeWidth="1.5" fill="none" />
        <text x="82" y="240" fontSize="11" fill="#4A6B52" fontFamily="sans-serif">Antes</text>
      </g>
      <g className="ba-right">
        <rect x="230" y="50" width="130" height="170" rx="8" stroke="#1C2B1E" strokeWidth="2" fill="#FAF7F3" />
        <ellipse cx="295" cy="120" rx="28" ry="38" stroke="#8FB49A" strokeWidth="1.5" fill="none" />
        <text x="270" y="240" fontSize="11" fill="#4A6B52" fontFamily="sans-serif">Depois</text>
      </g>
      <g className="ba-grid">
        <line x1="200" y1="60" x2="200" y2="210" stroke="#4A6B52" strokeWidth="1" strokeDasharray="4 3" />
        <line x1="50" y1="120" x2="350" y2="120" stroke="#4A6B52" strokeWidth="1" strokeDasharray="4 3" />
        <line x1="50" y1="160" x2="350" y2="160" stroke="#4A6B52" strokeWidth="1" strokeDasharray="4 3" />
      </g>
      <g className="ba-lock" transform="translate(190, 248)">
        <rect x="2" y="6" width="16" height="12" rx="2" fill="#4A6B52" />
        <path d="M5 6 V3 A5 5 0 0 1 15 3 V6" stroke="#4A6B52" strokeWidth="2" fill="none" />
      </g>
    </svg>
  )
}

export function GuidedCaptureDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes gc-face { 0% { transform: translateY(100px); } 30%, 60% { transform: translateY(0); } 85%, 100% { transform: translateY(100px); } }
        @keyframes gc-oval { 0%, 25% { stroke: #8FB49A; } 40%, 60% { stroke: #4A6B52; } 75%, 100% { stroke: #8FB49A; } }
        @keyframes gc-flash { 0%, 55% { opacity: 0; } 60% { opacity: 0.6; } 70%, 100% { opacity: 0; } }
        .gc-face { animation: gc-face 4s ease-in-out infinite; }
        .gc-oval { animation: gc-oval 4s ease-in-out infinite; }
        .gc-flash { animation: gc-flash 4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .gc-face, .gc-oval, .gc-flash { animation: none; } .gc-face { transform: translateY(0); } .gc-oval { stroke: #4A6B52; } .gc-flash { opacity: 0; } }
      `}</style>
      <rect x="80" y="20" width="240" height="240" rx="12" stroke="#1C2B1E" strokeWidth="2" fill="#FAF7F3" />
      <path d="M90 50 V32 H108" stroke="#4A6B52" strokeWidth="2.5" fill="none" />
      <path d="M310 50 V32 H292" stroke="#4A6B52" strokeWidth="2.5" fill="none" />
      <path d="M90 230 V248 H108" stroke="#4A6B52" strokeWidth="2.5" fill="none" />
      <path d="M310 230 V248 H292" stroke="#4A6B52" strokeWidth="2.5" fill="none" />
      <ellipse className="gc-oval" cx="200" cy="140" rx="55" ry="75" strokeWidth="2" strokeDasharray="6 4" fill="none" />
      <g className="gc-face">
        <ellipse cx="200" cy="140" rx="40" ry="55" stroke="#1C2B1E" strokeWidth="1.5" fill="none" />
        <ellipse cx="185" cy="125" rx="8" ry="4" stroke="#1C2B1E" strokeWidth="1" fill="none" />
        <ellipse cx="215" cy="125" rx="8" ry="4" stroke="#1C2B1E" strokeWidth="1" fill="none" />
        <path d="M192 155 Q200 163 208 155" stroke="#1C2B1E" strokeWidth="1" fill="none" />
      </g>
      <rect className="gc-flash" x="80" y="20" width="240" height="240" rx="12" fill="white" />
    </svg>
  )
}

// ─── Group 2: Fluxo sem Atrito ──────────────────────────────────────

export function GuidedFlowDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes gf-check { 0%, 10% { stroke-dashoffset: 14; } 25% { stroke-dashoffset: 0; } 75% { stroke-dashoffset: 0; } 90%, 100% { stroke-dashoffset: 14; } }
        @keyframes gf-pulse { 0%, 100% { r: 18; opacity: 0; } 50% { r: 24; opacity: 0.3; } }
        .gf-check { stroke-dasharray: 14; animation: gf-check 4s ease-in-out infinite; }
        .gf-c1 { animation-delay: 0s; } .gf-c2 { animation-delay: 0.6s; } .gf-c3 { animation-delay: 1.2s; } .gf-c4 { animation-delay: 1.8s; } .gf-c5 { animation-delay: 2.4s; }
        .gf-pulse { animation: gf-pulse 1.2s ease-in-out infinite; fill: #8FB49A; }
        @media (prefers-reduced-motion: reduce) { .gf-check, .gf-pulse { animation: none; } .gf-check { stroke-dashoffset: 0; } .gf-pulse { opacity: 0; } }
      `}</style>
      {['Anamnese', 'Avaliação', 'Planejamento', 'Aprovação', 'Execução'].map((label, i) => {
        const cx = 60 + i * 75
        return (
          <g key={label}>
            {i < 4 && <line x1={cx + 16} y1={140} x2={cx + 59} y2={140} stroke="#8FB49A" strokeWidth="2" />}
            <circle cx={cx} cy={140} r="16" stroke="#4A6B52" strokeWidth="2" fill="#FAF7F3" />
            <circle className="gf-pulse" cx={cx} cy={140} style={{ animationDelay: `${i * 0.6}s` }} />
            <path className={`gf-check gf-c${i + 1}`} d={`M${cx - 5} 140 L${cx - 1} 145 L${cx + 6} 134`} stroke="#4A6B52" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <text x={cx} y={175} textAnchor="middle" fontSize="9" fill="#4A6B52" fontFamily="sans-serif">{label}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function DigitalSignatureDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes ds-sign { 0% { stroke-dashoffset: 200; } 60% { stroke-dashoffset: 0; } 75% { stroke-dashoffset: 0; } 90%, 100% { stroke-dashoffset: 200; } }
        @keyframes ds-check { 0%, 60% { opacity: 0; transform: scale(0); } 70%, 75% { opacity: 1; transform: scale(1); } 90%, 100% { opacity: 0; transform: scale(0); } }
        .ds-sign { stroke-dasharray: 200; animation: ds-sign 4s ease-in-out infinite; }
        .ds-check { animation: ds-check 4s ease-in-out infinite; transform-origin: 200px 230px; }
        @media (prefers-reduced-motion: reduce) { .ds-sign, .ds-check { animation: none; } .ds-sign { stroke-dashoffset: 0; } .ds-check { opacity: 1; transform: scale(1); } }
      `}</style>
      <rect x="135" y="20" width="130" height="240" rx="14" stroke="#1C2B1E" strokeWidth="2" fill="#FAF7F3" />
      <rect x="143" y="40" width="114" height="190" rx="4" fill="white" stroke="#8FB49A" strokeWidth="0.5" />
      <rect x="158" y="60" width="84" height="6" rx="3" fill="#E8D5C8" />
      <rect x="158" y="76" width="70" height="6" rx="3" fill="#E8D5C8" />
      <rect x="158" y="92" width="78" height="6" rx="3" fill="#E8D5C8" />
      <rect x="158" y="108" width="60" height="6" rx="3" fill="#E8D5C8" />
      <line x1="158" y1="170" x2="242" y2="170" stroke="#8FB49A" strokeWidth="1" strokeDasharray="3 2" />
      <text x="158" y="185" fontSize="8" fill="#7A7A7A" fontFamily="sans-serif">Assinatura</text>
      <path className="ds-sign" d="M162 165 Q170 150 180 165 Q190 180 200 160 Q210 142 218 165 Q222 175 230 162 Q235 155 238 165" stroke="#1C2B1E" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <g className="ds-check">
        <circle cx="200" cy="210" r="12" fill="#4A6B52" />
        <path d="M194 210 L198 215 L207 204" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}

export function SelfServiceDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes ss-fill { 0%, 5% { transform: scaleX(0); } 20%, 70% { transform: scaleX(1); } 85%, 100% { transform: scaleX(0); } }
        @keyframes ss-btn { 0%, 60% { fill: #E8D5C8; } 65%, 75% { fill: #4A6B52; } 85%, 100% { fill: #E8D5C8; } }
        .ss-fill { transform-origin: left; }
        .ss-f1 { animation: ss-fill 4s ease-in-out infinite; animation-delay: 0s; }
        .ss-f2 { animation: ss-fill 4s ease-in-out infinite; animation-delay: 0.5s; }
        .ss-f3 { animation: ss-fill 4s ease-in-out infinite; animation-delay: 1.0s; }
        .ss-f4 { animation: ss-fill 4s ease-in-out infinite; animation-delay: 1.5s; }
        .ss-btn { animation: ss-btn 4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .ss-f1, .ss-f2, .ss-f3, .ss-f4, .ss-btn { animation: none; } .ss-fill { transform: scaleX(1); } .ss-btn { fill: #4A6B52; } }
      `}</style>
      <rect x="135" y="20" width="130" height="240" rx="14" stroke="#1C2B1E" strokeWidth="2" fill="#FAF7F3" />
      <rect x="143" y="40" width="114" height="190" rx="4" fill="white" stroke="#8FB49A" strokeWidth="0.5" />
      <text x="200" y="62" textAnchor="middle" fontSize="10" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="600">Anamnese</text>
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x="155" y={78 + i * 32} width="90" height="20" rx="4" stroke="#8FB49A" strokeWidth="1" fill="white" />
          <text x="160" y={87 + i * 32} fontSize="7" fill="#7A7A7A" fontFamily="sans-serif">
            {['Nome completo', 'Data de nascimento', 'Alergias', 'Medicamentos'][i]}
          </text>
          <rect className={`ss-fill ss-f${i + 1}`} x="155" y={78 + i * 32} width="90" height="20" rx="4" fill="#8FB49A" opacity="0.2" />
        </g>
      ))}
      <rect className="ss-btn" x="155" y="215" width="90" height="24" rx="6" />
      <text x="200" y="231" textAnchor="middle" fontSize="9" fill="white" fontFamily="sans-serif" fontWeight="600">Enviar</text>
    </svg>
  )
}

// ─── Group 3: Gestão do Negócio ─────────────────────────────────────

export function FinancialDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes fn-bar { 0% { transform: scaleY(0); } 25%, 70% { transform: scaleY(1); } 85%, 100% { transform: scaleY(0); } }
        @keyframes fn-num { 0%, 20% { opacity: 0; } 30%, 70% { opacity: 1; } 85%, 100% { opacity: 0; } }
        @keyframes fn-inst { 0%, 30% { fill: #E8D5C8; } 40%, 70% { fill: #4A6B52; } 85%, 100% { fill: #E8D5C8; } }
        .fn-bar { transform-origin: bottom; animation: fn-bar 4s ease-in-out infinite; }
        .fn-b1 { animation-delay: 0s; } .fn-b2 { animation-delay: 0.3s; } .fn-b3 { animation-delay: 0.6s; } .fn-b4 { animation-delay: 0.9s; }
        .fn-num { animation: fn-num 4s ease-in-out infinite; }
        .fn-inst { animation: fn-inst 4s ease-in-out infinite; }
        .fn-i1 { animation-delay: 1.2s; } .fn-i2 { animation-delay: 1.5s; } .fn-i3 { animation-delay: 1.8s; }
        @media (prefers-reduced-motion: reduce) { .fn-bar, .fn-num, .fn-inst { animation: none; } .fn-bar { transform: scaleY(1); } .fn-num { opacity: 1; } .fn-inst { fill: #4A6B52; } }
      `}</style>
      <line x1="80" y1="200" x2="320" y2="200" stroke="#8FB49A" strokeWidth="1" />
      {[0, 1, 2, 3].map((i) => {
        const heights = [100, 140, 80, 120]
        const x = 110 + i * 55
        return (
          <rect
            key={i}
            className={`fn-bar fn-b${i + 1}`}
            x={x}
            y={200 - heights[i]}
            width="30"
            height={heights[i]}
            rx="4"
            fill="#4A6B52"
            opacity="0.7"
          />
        )
      })}
      <text className="fn-num" x="200" y="52" textAnchor="middle" fontSize="20" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="700">R$ 12.450</text>
      <text className="fn-num" x="200" y="68" textAnchor="middle" fontSize="10" fill="#7A7A7A" fontFamily="sans-serif">receita do mês</text>
      <text x="120" y="240" fontSize="9" fill="#7A7A7A" fontFamily="sans-serif">Parcelas:</text>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <circle className={`fn-inst fn-i${i + 1}`} cx={195 + i * 28} cy={236} r="8" />
          <path d={`M${191 + i * 28} 236 L${194 + i * 28} 239 L${200 + i * 28} 232`} stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  )
}

export function PackagesDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes pk-dot { 0%, 10% { fill: #E8D5C8; } 25% { fill: #4A6B52; } 75% { fill: #4A6B52; } 90%, 100% { fill: #E8D5C8; } }
        @keyframes pk-prog { 0%, 10% { transform: scaleX(0); } 25%, 75% { transform: scaleX(1); } 90%, 100% { transform: scaleX(0); } }
        .pk-prog { transform-origin: left; }
        @keyframes pk-text { 0%, 10% { opacity: 0; } 25% { opacity: 1; } 75% { opacity: 1; } 90%, 100% { opacity: 0; } }
        .pk-dot { animation: pk-dot 4s ease-in-out infinite; }
        .pk-d1 { animation-delay: 0s; } .pk-d2 { animation-delay: 0.4s; } .pk-d3 { animation-delay: 0.8s; } .pk-d4 { animation-delay: 1.2s; } .pk-d5 { animation-delay: 1.6s; }
        .pk-prog { animation: pk-prog 4s ease-in-out infinite; }
        .pk-text { animation: pk-text 4s ease-in-out infinite; animation-delay: 1.0s; }
        @media (prefers-reduced-motion: reduce) { .pk-dot, .pk-prog, .pk-text { animation: none; } .pk-d1, .pk-d2, .pk-d3 { fill: #4A6B52; } .pk-text { opacity: 1; } }
      `}</style>
      <rect x="80" y="40" width="240" height="200" rx="12" stroke="#1C2B1E" strokeWidth="2" fill="#FAF7F3" />
      <text x="200" y="80" textAnchor="middle" fontSize="14" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="600">Pacote Facial Premium</text>
      <text x="200" y="100" textAnchor="middle" fontSize="10" fill="#7A7A7A" fontFamily="sans-serif">5 sessões de preenchimento</text>
      {[0, 1, 2, 3, 4].map((i) => (
        <circle
          key={i}
          className={`pk-dot pk-d${i + 1}`}
          cx={140 + i * 30}
          cy={135}
          r="10"
          fill="#E8D5C8"
          stroke="#4A6B52"
          strokeWidth="1.5"
        />
      ))}
      <text className="pk-text" x="200" y="170" textAnchor="middle" fontSize="12" fill="#4A6B52" fontFamily="sans-serif" fontWeight="600">3/5 sessões</text>
      <rect x="120" y="185" width="160" height="8" rx="4" fill="#E8D5C8" />
      <rect className="pk-prog" x="120" y="185" width="96" height="8" rx="4" fill="#4A6B52" />
    </svg>
  )
}

export function ConfirmationDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes conf-msg { 0%, 5% { opacity: 0; transform: translateY(10px); } 15% { opacity: 1; transform: translateY(0); } 70% { opacity: 1; } 85%, 100% { opacity: 0; } }
        @keyframes conf-check { 0%, 40% { opacity: 0; transform: scale(0); } 55% { opacity: 1; transform: scale(1.15); } 65%, 70% { transform: scale(1); } 85%, 100% { opacity: 0; } }
        .conf-msg { animation: conf-msg 4s ease-in-out infinite; }
        .conf-m1 { animation-delay: 0s; } .conf-m2 { animation-delay: 0.4s; } .conf-m3 { animation-delay: 0.8s; }
        .conf-check { animation: conf-check 4s ease-in-out infinite; transform-origin: center; animation-delay: 1.2s; }
        @media (prefers-reduced-motion: reduce) { .conf-msg, .conf-check { animation: none; opacity: 1; transform: none; } }
      `}</style>
      {/* Phone outline */}
      <rect x="130" y="20" width="140" height="240" rx="16" stroke="#1C2B1E" strokeWidth="2" fill="#FAF7F3" />
      <rect x="140" y="40" width="120" height="200" rx="4" fill="white" stroke="#E8D5C8" strokeWidth="0.5" />
      {/* WhatsApp header */}
      <rect x="140" y="40" width="120" height="28" rx="4" fill="#4A6B52" />
      <text x="200" y="58" textAnchor="middle" fontSize="9" fill="white" fontFamily="sans-serif" fontWeight="600">FloraClin</text>
      {/* Chat bubbles */}
      <g className="conf-msg conf-m1">
        <rect x="148" y="78" width="100" height="36" rx="8" fill="#4A6B52" opacity="0.1" />
        <text x="156" y="92" fontSize="7.5" fill="#1C2B1E" fontFamily="sans-serif">Olá Maria! Lembrete:</text>
        <text x="156" y="103" fontSize="7.5" fill="#1C2B1E" fontFamily="sans-serif">Consulta amanhã às 14h</text>
      </g>
      <g className="conf-msg conf-m2">
        <rect x="148" y="122" width="100" height="28" rx="8" fill="#4A6B52" opacity="0.1" />
        <text x="156" y="136" fontSize="7.5" fill="#1C2B1E" fontFamily="sans-serif">Confirmar ou Reagendar?</text>
      </g>
      {/* Patient reply */}
      <g className="conf-msg conf-m3">
        <rect x="178" y="158" width="74" height="24" rx="8" fill="#4A6B52" opacity="0.2" />
        <text x="192" y="174" fontSize="8" fill="#4A6B52" fontFamily="sans-serif" fontWeight="600">Confirmado ✓</text>
      </g>
      {/* Status check */}
      <g className="conf-check">
        <circle cx="200" cy="210" r="14" fill="#4A6B52" opacity="0.15" />
        <path d="M192 210 L198 216 L210 204" stroke="#4A6B52" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}

export function CrmDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes crm-row { 0%, 5% { opacity: 0; transform: translateX(-15px); } 20% { opacity: 1; transform: translateX(0); } 70% { opacity: 1; } 85%, 100% { opacity: 0; } }
        @keyframes crm-tag { 0%, 25% { opacity: 0; transform: scale(0.8); } 35% { opacity: 1; transform: scale(1); } 70% { opacity: 1; } 85%, 100% { opacity: 0; } }
        .crm-row { animation: crm-row 4s ease-in-out infinite; }
        .crm-r1 { animation-delay: 0s; } .crm-r2 { animation-delay: 0.25s; } .crm-r3 { animation-delay: 0.5s; } .crm-r4 { animation-delay: 0.75s; }
        .crm-tag { animation: crm-tag 4s ease-in-out infinite; }
        .crm-t1 { animation-delay: 0.6s; } .crm-t2 { animation-delay: 0.85s; } .crm-t3 { animation-delay: 1.1s; } .crm-t4 { animation-delay: 1.35s; }
        @media (prefers-reduced-motion: reduce) { .crm-row, .crm-tag { animation: none; opacity: 1; transform: none; } }
      `}</style>
      {/* Card background */}
      <rect x="40" y="24" width="320" height="232" rx="12" fill="white" stroke="#E8D5C8" strokeWidth="1" />
      {/* Header */}
      <text x="60" y="52" fontSize="11" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="600">Pacientes</text>
      <rect x="280" y="38" width="60" height="20" rx="10" fill="#4A6B52" opacity="0.1" />
      <text x="310" y="52" textAnchor="middle" fontSize="8" fill="#4A6B52" fontFamily="sans-serif">Filtrar</text>
      {/* Table header */}
      <text x="60" y="80" fontSize="8" fill="#7A7A7A" fontFamily="sans-serif">Nome</text>
      <text x="190" y="80" fontSize="8" fill="#7A7A7A" fontFamily="sans-serif">Último atend.</text>
      <text x="280" y="80" fontSize="8" fill="#7A7A7A" fontFamily="sans-serif">Status</text>
      <line x1="50" y1="86" x2="350" y2="86" stroke="#E8D5C8" strokeWidth="0.5" />
      {/* Row 1 */}
      <g className="crm-row crm-r1">
        <circle cx="68" cy="103" r="10" fill="#4A6B52" opacity="0.12" />
        <text x="68" y="107" textAnchor="middle" fontSize="8" fill="#4A6B52" fontFamily="sans-serif" fontWeight="600">M</text>
        <text x="86" y="107" fontSize="9" fill="#1C2B1E" fontFamily="sans-serif">Maria Silva</text>
        <text x="190" y="107" fontSize="8.5" fill="#7A7A7A" fontFamily="sans-serif">12/05/2026</text>
      </g>
      <g className="crm-tag crm-t1"><rect x="274" y="94" width="60" height="18" rx="9" fill="#4A6B52" opacity="0.15" /><text x="304" y="106" textAnchor="middle" fontSize="7.5" fill="#4A6B52" fontFamily="sans-serif">Retorno</text></g>
      {/* Row 2 */}
      <g className="crm-row crm-r2">
        <circle cx="68" cy="138" r="10" fill="#8FB49A" opacity="0.15" />
        <text x="68" y="142" textAnchor="middle" fontSize="8" fill="#4A6B52" fontFamily="sans-serif" fontWeight="600">J</text>
        <text x="86" y="142" fontSize="9" fill="#1C2B1E" fontFamily="sans-serif">João Mendes</text>
        <text x="190" y="142" fontSize="8.5" fill="#7A7A7A" fontFamily="sans-serif">28/04/2026</text>
      </g>
      <g className="crm-tag crm-t2"><rect x="274" y="129" width="60" height="18" rx="9" fill="#E8D5C8" opacity="0.5" /><text x="304" y="141" textAnchor="middle" fontSize="7.5" fill="#96725B" fontFamily="sans-serif">Follow-up</text></g>
      {/* Row 3 */}
      <g className="crm-row crm-r3">
        <circle cx="68" cy="173" r="10" fill="#4A6B52" opacity="0.12" />
        <text x="68" y="177" textAnchor="middle" fontSize="8" fill="#4A6B52" fontFamily="sans-serif" fontWeight="600">A</text>
        <text x="86" y="177" fontSize="9" fill="#1C2B1E" fontFamily="sans-serif">Ana Costa</text>
        <text x="190" y="177" fontSize="8.5" fill="#7A7A7A" fontFamily="sans-serif">05/05/2026</text>
      </g>
      <g className="crm-tag crm-t3"><rect x="274" y="164" width="60" height="18" rx="9" fill="#4A6B52" opacity="0.15" /><text x="304" y="176" textAnchor="middle" fontSize="7.5" fill="#4A6B52" fontFamily="sans-serif">Ativo</text></g>
      {/* Row 4 */}
      <g className="crm-row crm-r4">
        <circle cx="68" cy="208" r="10" fill="#8FB49A" opacity="0.15" />
        <text x="68" y="212" textAnchor="middle" fontSize="8" fill="#4A6B52" fontFamily="sans-serif" fontWeight="600">C</text>
        <text x="86" y="212" fontSize="9" fill="#1C2B1E" fontFamily="sans-serif">Carlos Lima</text>
        <text x="190" y="212" fontSize="8.5" fill="#7A7A7A" fontFamily="sans-serif">15/03/2026</text>
      </g>
      <g className="crm-tag crm-t4"><rect x="274" y="199" width="60" height="18" rx="9" fill="#F5E6E0" opacity="0.7" /><text x="304" y="211" textAnchor="middle" fontSize="7.5" fill="#C0392B" fontFamily="sans-serif">Inativo</text></g>
    </svg>
  )
}

export function CalendarDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes cal-block { 0%, 10% { opacity: 0; transform: scaleY(0); } 25% { opacity: 1; transform: scaleY(1); } 70% { opacity: 1; transform: scaleY(1); } 85%, 100% { opacity: 0; transform: scaleY(0); } }
        @keyframes cal-sync { 0%, 40% { opacity: 0; } 50%, 70% { opacity: 1; } 55%, 65% { transform: scale(1.1); } 85%, 100% { opacity: 0; } }
        .cal-block { transform-origin: top; animation: cal-block 4s ease-in-out infinite; }
        .cal-b1 { animation-delay: 0s; } .cal-b2 { animation-delay: 0.3s; } .cal-b3 { animation-delay: 0.6s; } .cal-b4 { animation-delay: 0.9s; } .cal-b5 { animation-delay: 0.4s; }
        .cal-sync { animation: cal-sync 4s ease-in-out infinite; transform-origin: center; }
        @media (prefers-reduced-motion: reduce) { .cal-block, .cal-sync { animation: none; opacity: 1; transform: none; } }
      `}</style>
      {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((day, i) => {
        const x = 52 + i * 46
        return (
          <g key={day}>
            <text x={x + 18} y={52} textAnchor="middle" fontSize="9" fill="#7A7A7A" fontFamily="sans-serif">{day}</text>
            <line x1={x} y1={58} x2={x + 36} y2={58} stroke="#E8D5C8" strokeWidth="1" />
            <rect x={x} y={60} width="36" height="150" fill="none" stroke="#E8D5C8" strokeWidth="0.5" />
          </g>
        )
      })}
      <rect className="cal-block cal-b1" x="54" y="70" width="32" height="35" rx="4" fill="#4A6B52" opacity="0.7" />
      <rect className="cal-block cal-b2" x="146" y="90" width="32" height="45" rx="4" fill="#8FB49A" opacity="0.7" />
      <rect className="cal-block cal-b3" x="192" y="75" width="32" height="30" rx="4" fill="#4A6B52" opacity="0.7" />
      <rect className="cal-block cal-b4" x="284" y="110" width="32" height="40" rx="4" fill="#8FB49A" opacity="0.7" />
      <rect className="cal-block cal-b5" x="100" y="130" width="32" height="35" rx="4" fill="#4A6B52" opacity="0.5" />
      <g className="cal-sync" transform="translate(155, 228)">
        <circle cx="0" cy="8" r="10" fill="white" stroke="#4A6B52" strokeWidth="1.5" />
        <text x="0" y="12" textAnchor="middle" fontSize="12" fill="#4A6B52" fontFamily="sans-serif" fontWeight="700">G</text>
        <line x1="16" y1="8" x2="56" y2="8" stroke="#4A6B52" strokeWidth="1.5" />
        <path d="M50 3 L58 8 L50 13" stroke="#4A6B52" strokeWidth="1.5" fill="none" />
        <path d="M22 3 L14 8 L22 13" stroke="#4A6B52" strokeWidth="1.5" fill="none" />
        <rect x="60" y="0" width="16" height="16" rx="2" stroke="#4A6B52" strokeWidth="1.5" fill="white" />
        <line x1="60" y1="5" x2="76" y2="5" stroke="#4A6B52" strokeWidth="1" />
      </g>
    </svg>
  )
}

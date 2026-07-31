/**
 * CRM demo: reference implementation for the demo motion language.
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
 * Scene: the real lead pipeline (novo → contatado → qualificado → agendado),
 * with a card advancing to "Agendado" the way scheduling moves a lead.
 */

const COLS = [
  { label: 'Novo', x: 16, from: '2', to: '2' },
  { label: 'Contatado', x: 110, from: '1', to: '1' },
  { label: 'Qualificado', x: 204, from: '2', to: '1' },
  { label: 'Agendado', x: 298, from: '0', to: '1' },
]

function Card({
  x,
  y,
  initial,
  name,
}: {
  x: number
  y: number
  initial: string
  name: string
}) {
  return (
    <>
      <rect x={x + 6} y={y} width="72" height="38" rx="7" fill="white" stroke="#E8D5C8" strokeWidth="1" />
      <circle cx={x + 21} cy={y + 13} r="8" fill="#4A6B52" opacity="0.12" />
      <text x={x + 21} y={y + 16} textAnchor="middle" fontSize="8" fill="#4A6B52" fontFamily="sans-serif" fontWeight="600">
        {initial}
      </text>
      <text x={x + 34} y={y + 16} fontSize="7.5" fill="#2A2A2A" fontFamily="sans-serif">
        {name}
      </text>
      <rect x={x + 14} y={y + 23} width="44" height="4" rx="2" fill="#E8D5C8" />
    </>
  )
}

export function CrmDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes crm-col { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes crm-card { from { opacity: 0; transform: translateY(8px) scale(0.94); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes crm-move {
          0%, 34%  { transform: translate(0, 0) scale(1); }
          39%      { transform: translate(0, -3px) scale(1.05); }
          58%      { transform: translate(94px, -3px) scale(1.05); }
          64%      { transform: translate(94px, 2px) scale(0.985); }
          70%, 100%{ transform: translate(94px, 0) scale(1); }
        }
        @keyframes crm-lift {
          0%, 34%   { filter: drop-shadow(0 1px 1px rgba(28,43,30,0.05)); }
          40%, 60%  { filter: drop-shadow(0 5px 8px rgba(28,43,30,0.22)); }
          72%, 100% { filter: drop-shadow(0 1px 2px rgba(28,43,30,0.08)); }
        }
        @keyframes crm-tag { 0%, 60% { opacity: 0; transform: scale(0.6); } 68% { opacity: 1; transform: scale(1); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes crm-out { 0%, 64% { opacity: 1; } 70%, 100% { opacity: 0; } }
        @keyframes crm-in  { 0%, 64% { opacity: 0; transform: scale(0.5); } 72% { opacity: 1; transform: scale(1); } 100% { opacity: 1; transform: scale(1); } }

        .crm-col  { opacity: 0; animation: crm-col 0.55s var(--e-out) forwards; }
        .crm-c1 { animation-delay: 0s; } .crm-c2 { animation-delay: 0.07s; }
        .crm-c3 { animation-delay: 0.14s; } .crm-c4 { animation-delay: 0.21s; }

        .crm-card { opacity: 0; animation: crm-card 0.5s var(--e-out) forwards; }
        .crm-k1 { animation-delay: 0.42s; } .crm-k2 { animation-delay: 0.51s; }
        .crm-k3 { animation-delay: 0.60s; } .crm-k4 { animation-delay: 0.78s; }

        .crm-mover  { animation: crm-move 4.2s var(--e-io) forwards; }
        .crm-shadow { animation: crm-lift 4.2s linear forwards; }
        .crm-tag    { opacity: 0; animation: crm-tag 4.2s var(--e-pop) forwards; transform-box: fill-box; transform-origin: center; }
        .crm-nfrom  { animation: crm-out 4.2s linear forwards; }
        .crm-nto    { opacity: 0; animation: crm-in 4.2s var(--e-pop) forwards; transform-box: fill-box; transform-origin: center; }

        @media (prefers-reduced-motion: reduce) {
          .crm-col, .crm-card, .crm-mover, .crm-shadow, .crm-tag, .crm-nfrom, .crm-nto { animation: none; }
          .crm-col, .crm-card { opacity: 1; transform: none; }
          .crm-mover { transform: translate(94px, 0); }
          .crm-tag, .crm-nto { opacity: 1; transform: none; }
          .crm-nfrom { opacity: 0; }
        }
      `}</style>

      <text x="16" y="26" fontSize="11" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="600">Pipeline de leads</text>

      {COLS.map((col, i) => (
        <g key={col.label} className={`crm-col crm-c${i + 1}`}>
          <text x={col.x + 6} y={44} fontSize="7.5" fill="#7A7A7A" fontFamily="sans-serif" fontWeight="600">
            {col.label}
          </text>
          <rect x={col.x + 62} y={35} width="16" height="12" rx="6" fill="#4A6B52" opacity="0.1" />
          {/* Counter: the "from" value fades out as the "to" value pops in. */}
          <text
            className={col.from === col.to ? undefined : 'crm-nfrom'}
            x={col.x + 70}
            y={44}
            textAnchor="middle"
            fontSize="7"
            fill="#4A6B52"
            fontFamily="sans-serif"
            fontWeight="700"
          >
            {col.from}
          </text>
          {col.from !== col.to && (
            <text
              className="crm-nto"
              x={col.x + 70}
              y={44}
              textAnchor="middle"
              fontSize="7"
              fill="#4A6B52"
              fontFamily="sans-serif"
              fontWeight="700"
            >
              {col.to}
            </text>
          )}
          <rect x={col.x} y={52} width="84" height="200" rx="8" fill="#FAF7F3" stroke="#E8D5C8" strokeWidth="1" />
        </g>
      ))}

      <g className="crm-card crm-k1"><Card x={16} y={62} initial="M" name="Maria S." /></g>
      <g className="crm-card crm-k2"><Card x={16} y={108} initial="P" name="Paula R." /></g>
      <g className="crm-card crm-k3"><Card x={110} y={62} initial="J" name="João M." /></g>
      <g className="crm-card crm-k4"><Card x={204} y={108} initial="C" name="Carlos L." /></g>

      {/* The lead that advances: lifts, travels one column, settles, gets tagged. */}
      <g className="crm-mover">
        <g className="crm-shadow">
          <Card x={204} y={62} initial="A" name="Ana C." />
          <g className="crm-tag">
            <rect x={218} y={85} width="44" height="11" rx="5.5" fill="#4A6B52" />
            <text x={240} y={93} textAnchor="middle" fontSize="6.5" fill="white" fontFamily="sans-serif" fontWeight="600">
              Agendado
            </text>
          </g>
        </g>
      </g>
    </svg>
  )
}

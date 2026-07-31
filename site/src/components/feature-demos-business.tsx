/**
 * Business demos. Follows the motion language set by feature-demos-crm.
 *
 * Three rules every demo follows:
 *   1. Play once and hold. The showcase remounts each demo when its tab
 *      activates (key={activeIndex}) and cycles every 5s, so the story runs
 *      inside ~4.2s and keeps its final frame. No infinite loop, no reset flash.
 *   2. Easing carries intent: --e-out for entrances, --e-pop for payoffs,
 *      --e-io for travel. Never ease-in-out for everything.
 *   3. Compositor-friendly only: transform, opacity, filter. Never animate SVG
 *      geometry attributes like r or width.
 */

// ─── Financeiro Completo ────────────────────────────────────────────

/**
 * Ratios are the real share of the R$ 12.450 headline, so the bars are honest
 * rather than decorative. Bars render at their true width and grow via scaleX.
 */
const TRACK_X = 44
const TRACK_W = 240

const STATS = [
  { label: 'Comissões', value: 'R$ 3.100', ratio: 3100 / 12450, color: '#8FB49A', accent: false },
  { label: 'Despesas', value: 'R$ 2.240', ratio: 2240 / 12450, color: '#E8D5C8', accent: false },
  { label: 'Líquido', value: 'R$ 7.110', ratio: 7110 / 12450, color: '#4A6B52', accent: true },
]

/** 6 installments, first 3 paid. Step 32 = 26px pill + 6px gap. */
const PILL_X = (i: number) => 98 + i * 32
const PAID = 3

export function FinancialDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes fn-card { from { opacity: 0; transform: scale(0.985); } to { opacity: 1; transform: scale(1); } }
        @keyframes fn-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        /* Rolls up from behind the clip rect, so the figure reads as landing in place. */
        @keyframes fn-roll { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fn-row  { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes fn-bar  { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes fn-pill { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
        @keyframes fn-chip { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }

        .fn-card { opacity: 0; animation: fn-card 0.5s var(--e-out) forwards; transform-box: fill-box; transform-origin: center; }
        .fn-title { opacity: 0; animation: fn-fade 0.45s var(--e-out) 0.15s forwards; }
        .fn-roll { opacity: 0; animation: fn-roll 0.6s var(--e-out) 0.4s forwards; }
        .fn-cap  { opacity: 0; animation: fn-fade 0.45s var(--e-out) 0.6s forwards; }

        .fn-row { opacity: 0; animation: fn-row 0.5s var(--e-out) forwards; }
        .fn-r1 { animation-delay: 0.80s; } .fn-r2 { animation-delay: 0.88s; } .fn-r3 { animation-delay: 0.96s; }

        .fn-bar { animation: fn-bar 0.7s var(--e-io) forwards; transform: scaleX(0); transform-box: fill-box; transform-origin: left; }
        .fn-g1 { animation-delay: 0.92s; } .fn-g2 { animation-delay: 1.00s; } .fn-g3 { animation-delay: 1.08s; }

        .fn-plabel { opacity: 0; animation: fn-fade 0.45s var(--e-out) 1.9s forwards; }
        .fn-pill { opacity: 0; animation: fn-pill 0.4s var(--e-pop) forwards; transform-box: fill-box; transform-origin: center; }
        .fn-p1 { animation-delay: 2.00s; } .fn-p2 { animation-delay: 2.09s; } .fn-p3 { animation-delay: 2.18s; }
        .fn-p4 { animation-delay: 2.27s; } .fn-p5 { animation-delay: 2.36s; } .fn-p6 { animation-delay: 2.45s; }

        .fn-fill { animation: fn-bar 0.35s var(--e-out) forwards; transform: scaleX(0); transform-box: fill-box; transform-origin: left; }
        .fn-f1 { animation-delay: 2.10s; } .fn-f2 { animation-delay: 2.19s; } .fn-f3 { animation-delay: 2.28s; }

        .fn-count { opacity: 0; animation: fn-fade 0.4s var(--e-out) 2.9s forwards; }
        .fn-multa { opacity: 0; animation: fn-chip 0.45s var(--e-pop) 3.2s forwards; transform-box: fill-box; transform-origin: center; }

        @media (prefers-reduced-motion: reduce) {
          .fn-card, .fn-title, .fn-roll, .fn-cap, .fn-row, .fn-bar,
          .fn-plabel, .fn-pill, .fn-fill, .fn-count, .fn-multa { animation: none; opacity: 1; transform: none; }
          .fn-bar, .fn-fill { transform: scaleX(1); }
        }
      `}</style>

      <defs>
        {/* Masks the headline figure while it slides up into position. */}
        <clipPath id="fn-revclip">
          <rect x="40" y="58" width="220" height="24" />
        </clipPath>
      </defs>

      <rect className="fn-card" x="20" y="16" width="360" height="248" rx="12" fill="white" stroke="#E8D5C8" strokeWidth="1" />

      <text className="fn-title" x="44" y="40" fontSize="11" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="600">
        Financeiro · Julho
      </text>

      <g clipPath="url(#fn-revclip)">
        <text className="fn-roll" x="44" y="78" fontSize="22" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="700">
          R$ 12.450
        </text>
      </g>
      <text className="fn-cap" x="44" y="94" fontSize="9" fill="#7A7A7A" fontFamily="sans-serif">
        receita do mês
      </text>

      {STATS.map((stat, i) => {
        const top = 108 + i * 34
        return (
          <g key={stat.label}>
            <g className={`fn-row fn-r${i + 1}`}>
              <text x={TRACK_X} y={top + 8} fontSize="9" fill="#7A7A7A" fontFamily="sans-serif">
                {stat.label}
              </text>
              <text
                x="356"
                y={top + 8}
                textAnchor="end"
                fontSize="10"
                fill={stat.accent ? '#4A6B52' : '#2A2A2A'}
                fontFamily="sans-serif"
                fontWeight={stat.accent ? '700' : '600'}
              >
                {stat.value}
              </text>
            </g>
            <rect x={TRACK_X} y={top + 14} width={TRACK_W} height="5" rx="2.5" fill="#FAF7F3" />
            <rect
              className={`fn-bar fn-g${i + 1}`}
              x={TRACK_X}
              y={top + 14}
              width={Math.round(stat.ratio * TRACK_W)}
              height="5"
              rx="2.5"
              fill={stat.color}
            />
          </g>
        )
      })}

      <text className="fn-plabel" x="44" y="233" fontSize="9" fill="#7A7A7A" fontFamily="sans-serif">
        Parcelas
      </text>

      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i}>
          <rect
            className={`fn-pill fn-p${i + 1}`}
            x={PILL_X(i)}
            y="224"
            width="26"
            height="13"
            rx="6.5"
            fill="white"
            stroke="#8FB49A"
            strokeWidth="1"
          />
          {i < PAID && (
            <rect className={`fn-fill fn-f${i + 1}`} x={PILL_X(i)} y="224" width="26" height="13" rx="6.5" fill="#4A6B52" />
          )}
        </g>
      ))}

      <text className="fn-count" x="292" y="233" fontSize="8" fill="#4A6B52" fontFamily="sans-serif" fontWeight="600">
        3/6 pagas
      </text>

      {/* Late fee lands on the first pending installment; the tick ties the
          chip to the pill it belongs to instead of leaving it floating. */}
      <g className="fn-multa">
        <line x1={PILL_X(3) + 13} y1="219" x2={PILL_X(3) + 13} y2="224" stroke="#C2785C" strokeWidth="1.5" />
        <rect x={PILL_X(3) - 9} y="206" width="44" height="13" rx="6.5" fill="#C2785C" />
        <text x={PILL_X(3) + 13} y="215" textAnchor="middle" fontSize="7" fill="white" fontFamily="sans-serif" fontWeight="600">
          + multa
        </text>
      </g>
    </svg>
  )
}

// ─── Agenda com Google Calendar ─────────────────────────────────────

const DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const COL_X = (i: number) => 20 + i * 54

/** Booked slots. Column 3 (Qui) is left empty for the event arriving from Google. */
const BLOCKS = [
  { x: COL_X(0) + 4, y: 64, h: 30, fill: '#4A6B52' },
  { x: COL_X(1) + 4, y: 96, h: 26, fill: '#8FB49A' },
  { x: COL_X(2) + 4, y: 68, h: 34, fill: '#4A6B52' },
  { x: COL_X(4) + 4, y: 88, h: 30, fill: '#8FB49A' },
  { x: COL_X(5) + 4, y: 124, h: 26, fill: '#4A6B52' },
]

const NEW_BLOCK = { x: COL_X(3) + 4, y: 110, h: 32 }

export function CalendarDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes cal-col   { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes cal-block { from { opacity: 0; transform: scaleY(0.2); } to { opacity: 1; transform: scaleY(1); } }
        @keyframes cal-fade  { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        /* Bounded repeat (2 cycles) so it reads as "syncing", then clears. */
        @keyframes cal-right { 0% { opacity: 0; transform: translateX(0); } 18% { opacity: 1; } 82% { opacity: 1; } 100% { opacity: 0; transform: translateX(160px); } }
        @keyframes cal-left  { 0% { opacity: 0; transform: translateX(0); } 18% { opacity: 1; } 82% { opacity: 1; } 100% { opacity: 0; transform: translateX(-160px); } }
        /* Dashed placeholder: drops in, holds, then hands off to the solid block. */
        @keyframes cal-ghost { 0% { opacity: 0; transform: scaleY(0.2); } 30% { opacity: 1; transform: scaleY(1); } 65% { opacity: 1; transform: scaleY(1); } 100% { opacity: 0; transform: scaleY(1); } }
        @keyframes cal-chip  { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }

        .cal-col { opacity: 0; animation: cal-col 0.4s var(--e-out) forwards; }
        .cal-d1 { animation-delay: 0s; }    .cal-d2 { animation-delay: 0.06s; }
        .cal-d3 { animation-delay: 0.12s; } .cal-d4 { animation-delay: 0.18s; }
        .cal-d5 { animation-delay: 0.24s; } .cal-d6 { animation-delay: 0.30s; }
        .cal-d7 { animation-delay: 0.36s; }

        .cal-block { opacity: 0; animation: cal-block 0.5s var(--e-pop) forwards; transform-box: fill-box; transform-origin: top; }
        .cal-b1 { animation-delay: 0.50s; } .cal-b2 { animation-delay: 0.59s; }
        .cal-b3 { animation-delay: 0.68s; } .cal-b4 { animation-delay: 0.77s; }
        .cal-b5 { animation-delay: 0.86s; }

        .cal-sync { opacity: 0; animation: cal-fade 0.5s var(--e-out) 1.6s forwards; }
        .cal-right { opacity: 0; animation: cal-right 0.55s var(--e-io) 1.8s 2 forwards; }
        .cal-left  { opacity: 0; animation: cal-left  0.55s var(--e-io) 1.8s 2 forwards; }

        .cal-ghost { opacity: 0; animation: cal-ghost 0.6s var(--e-out) 2.9s forwards; transform-box: fill-box; transform-origin: top; }
        .cal-new   { opacity: 0; animation: cal-block 0.4s var(--e-pop) 3.25s forwards; transform-box: fill-box; transform-origin: top; }
        .cal-chip  { opacity: 0; animation: cal-chip 0.45s var(--e-pop) 3.3s forwards; transform-box: fill-box; transform-origin: center; }

        @media (prefers-reduced-motion: reduce) {
          .cal-col, .cal-block, .cal-sync, .cal-right, .cal-left,
          .cal-ghost, .cal-new, .cal-chip { animation: none; opacity: 1; transform: none; }
          .cal-right, .cal-left, .cal-ghost { opacity: 0; }
        }
      `}</style>

      <text x="20" y="28" fontSize="11" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="600">
        Agenda da semana
      </text>

      {DAYS.map((day, i) => (
        <g key={day} className={`cal-col cal-d${i + 1}`}>
          <text x={COL_X(i) + 23} y="48" textAnchor="middle" fontSize="8" fill="#7A7A7A" fontFamily="sans-serif">
            {day}
          </text>
          <rect x={COL_X(i)} y="56" width="46" height="140" rx="6" fill="#FAF7F3" stroke="#E8D5C8" strokeWidth="1" />
        </g>
      ))}

      {BLOCKS.map((b, i) => (
        <g key={i} className={`cal-block cal-b${i + 1}`}>
          <rect x={b.x} y={b.y} width="38" height={b.h} rx="4" fill={b.fill} opacity="0.85" />
          <rect x={b.x + 6} y={b.y + 7} width="24" height="3" rx="1.5" fill="white" opacity="0.55" />
          <rect x={b.x + 6} y={b.y + 14} width="15" height="3" rx="1.5" fill="white" opacity="0.35" />
        </g>
      ))}

      {/* The event arriving from Google: dashed placeholder first, then the real block. */}
      <rect
        className="cal-ghost"
        x={NEW_BLOCK.x}
        y={NEW_BLOCK.y}
        width="38"
        height={NEW_BLOCK.h}
        rx="4"
        fill="none"
        stroke="#8FB49A"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
      <g className="cal-new">
        <rect x={NEW_BLOCK.x} y={NEW_BLOCK.y} width="38" height={NEW_BLOCK.h} rx="4" fill="#4A6B52" opacity="0.85" />
        <rect x={NEW_BLOCK.x + 6} y={NEW_BLOCK.y + 7} width="24" height="3" rx="1.5" fill="white" opacity="0.55" />
        <rect x={NEW_BLOCK.x + 6} y={NEW_BLOCK.y + 14} width="15" height="3" rx="1.5" fill="white" opacity="0.35" />
      </g>

      <g className="cal-sync">
        <circle cx="90" cy="232" r="14" fill="white" stroke="#4A6B52" strokeWidth="1.5" />
        <text x="90" y="237" textAnchor="middle" fontSize="14" fill="#4A6B52" fontFamily="sans-serif" fontWeight="700">
          G
        </text>
        <line x1="108" y1="232" x2="290" y2="232" stroke="#E8D5C8" strokeWidth="1.5" />
        <rect x="292" y="218" width="30" height="28" rx="7" fill="#4A6B52" />
        <text x="307" y="236" textAnchor="middle" fontSize="10" fill="white" fontFamily="sans-serif" fontWeight="700">
          FC
        </text>
      </g>

      {/* Two chevrons crossing in opposite directions along the connector. */}
      <g transform="translate(116, 226)">
        <path className="cal-right" d="M0 0 L5 4 L0 8" stroke="#4A6B52" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g transform="translate(280, 234)">
        <path className="cal-left" d="M0 0 L-5 4 L0 8" stroke="#8FB49A" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* Sits on the connector rather than above it, so it reads as the state
          of the link. The chevrons have already faded by the time it lands. */}
      <g className="cal-chip">
        <rect x="155" y="223" width="90" height="18" rx="9" fill="#4A6B52" />
        <path d="M164 232 L167 235 L173 228" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text x="179" y="235" fontSize="8" fill="white" fontFamily="sans-serif" fontWeight="600">
          Sincronizado
        </text>
      </g>
    </svg>
  )
}

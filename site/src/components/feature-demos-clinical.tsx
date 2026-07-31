/**
 * Clinical demos: face diagram, before/after alignment, guided capture.
 *
 * Same three rules as the CRM demo:
 *   1. Play once and hold. The showcase remounts each demo when its tab
 *      activates and cycles every 6s, so each story runs inside ~4.2s (the
 *      before/after comparison takes 5s) and keeps its final frame. No
 *      infinite loop, no reset flash.
 *   2. Easing carries intent: --e-out for entrances, --e-pop for payoffs,
 *      --e-io for travel. Never ease-in-out for everything.
 *   3. Compositor-friendly only: transform, opacity, filter (plus
 *      stroke-dashoffset for draw-on strokes). Never animate SVG geometry
 *      attributes like r, width or cx.
 *
 * Class and keyframe prefixes are unique per demo (fd-, ba-, gc-) because
 * every demo can be in the DOM at once.
 */

import { useId } from 'react'

// ─── Diagrama facial ────────────────────────────────────────────────
//
// Scene: what the product actually records: a product and a dose per point,
// on one of three face views. Not anatomy labels.

/**
 * The face is the app's own female-front template, cropped to the head so it
 * fills the frame (the full 340x440 asset leaves a quarter of its height on
 * neck and hair). It sits at x 132..268, clear of the dose chips on both
 * sides. Point coordinates below are anatomy on that crop: testa, pés de
 * galinha, sulco nasogeniano, mento.
 */
const FACE_SRC = '/face-templates/female-front.webp'
/** Same face with the lines a treatment softens, registered to FACE_SRC on
 *  the eye line and interocular distance so the two stack exactly. */
const FACE_SRC_ANTES = '/face-templates/female-front-antes.webp'
const FACE_IMAGE = { x: 132, y: 56, width: 136, height: 176 }

const FACE_POINTS = [
  // dot: where the application lands. leader: chip edge → just short of the dot.
  { dot: [199, 113], leader: [272, 113, 206, 113], chip: [272, 105, 58], side: 'r', label: 'Botox 20U' },
  { dot: [162, 148], leader: [128, 148, 155, 148], chip: [70, 140, 58], side: 'l', label: 'Botox 12U' },
  { dot: [235, 148], leader: [272, 148, 242, 148], chip: [272, 140, 54], side: 'r', label: 'Botox 8U' },
  { dot: [184, 183], leader: [128, 183, 177, 183], chip: [60, 175, 68], side: 'l', label: 'Ácido H. 1ml' },
  { dot: [199, 204], leader: [272, 204, 206, 204], chip: [272, 196, 74], side: 'r', label: 'Preench. 0,8ml' },
] as const

const FACE_VIEWS = [
  { label: 'Frontal', x: 16, active: true },
  { label: 'Perfil E', x: 74, active: false },
  { label: 'Perfil D', x: 132, active: false },
]

export function FaceDiagramDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes fd-face  { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
        @keyframes fd-fade  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fd-tab   { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        /* --e-pop is a back-out curve, so 0 → 1 already carries the ~1.15 overshoot. */
        @keyframes fd-dot   { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: scale(1); } }
        @keyframes fd-ring  { from { opacity: 0.5; transform: scale(0.5); } to { opacity: 0; transform: scale(2.6); } }
        @keyframes fd-chipr { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes fd-chipl { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes fd-sum   { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }

        .fd-face { opacity: 0; animation: fd-face 0.6s var(--e-out) forwards; transform-box: fill-box; transform-origin: center; }

        .fd-tab { opacity: 0; animation: fd-tab 0.4s var(--e-out) forwards; }
        .fd-v1 { animation-delay: 0.30s; } .fd-v2 { animation-delay: 0.37s; } .fd-v3 { animation-delay: 0.44s; }

        .fd-dot  { opacity: 0; animation: fd-dot 0.42s var(--e-pop) forwards; transform-box: fill-box; transform-origin: center; }
        .fd-ring { opacity: 0; animation: fd-ring 0.6s var(--e-out) forwards; transform-box: fill-box; transform-origin: center; }
        .fd-p1 { animation-delay: 0.70s; } .fd-p2 { animation-delay: 1.00s; }
        .fd-p3 { animation-delay: 1.30s; } .fd-p4 { animation-delay: 1.60s; } .fd-p5 { animation-delay: 1.90s; }

        .fd-chip-r { opacity: 0; animation: fd-chipr 0.38s var(--e-out) forwards; }
        .fd-chip-l { opacity: 0; animation: fd-chipl 0.38s var(--e-out) forwards; }
        .fd-q1 { animation-delay: 0.82s; } .fd-q2 { animation-delay: 1.12s; }
        .fd-q3 { animation-delay: 1.42s; } .fd-q4 { animation-delay: 1.72s; } .fd-q5 { animation-delay: 2.02s; }

        .fd-sum { opacity: 0; animation: fd-sum 0.5s var(--e-pop) 2.55s forwards; }

        @media (prefers-reduced-motion: reduce) {
          .fd-face, .fd-tab, .fd-dot, .fd-ring,
          .fd-chip-r, .fd-chip-l, .fd-sum { animation: none; }
          .fd-face, .fd-tab, .fd-dot, .fd-chip-r, .fd-chip-l, .fd-sum { opacity: 1; transform: none; }
          .fd-ring { opacity: 0; }
        }
      `}</style>

      <text x="16" y="20" fontSize="11" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="600">Diagrama facial</text>

      {/* View switcher. The record is per view, not a single flat drawing. */}
      {FACE_VIEWS.map((view, i) => (
        <g key={view.label} className={`fd-tab fd-v${i + 1}`}>
          <rect
            x={view.x}
            y={32}
            width="54"
            height="18"
            rx="9"
            fill={view.active ? '#4A6B52' : '#FAF7F3'}
            stroke={view.active ? '#4A6B52' : '#E8D5C8'}
            strokeWidth="1"
          />
          <text
            x={view.x + 27}
            y={44}
            textAnchor="middle"
            fontSize="7.5"
            fill={view.active ? 'white' : '#7A7A7A'}
            fontFamily="sans-serif"
            fontWeight="600"
          >
            {view.label}
          </text>
        </g>
      ))}

      <g className="fd-face">
        <rect
          x={FACE_IMAGE.x - 6}
          y={FACE_IMAGE.y - 5}
          width={FACE_IMAGE.width + 12}
          height={FACE_IMAGE.height + 10}
          rx="8"
          fill="white"
          stroke="#E8D5C8"
          strokeWidth="1"
        />
        <image href={FACE_SRC} {...FACE_IMAGE} />
      </g>

      {FACE_POINTS.map((point, i) => {
        const [cx, cy] = point.dot
        const [lx1, ly1, lx2, ly2] = point.leader
        const [chipX, chipY, chipW] = point.chip
        return (
          <g key={point.label}>
            <circle className={`fd-ring fd-p${i + 1}`} cx={cx} cy={cy} r="6" fill="none" stroke="#4A6B52" strokeWidth="2" />
            <circle className={`fd-dot fd-p${i + 1}`} cx={cx} cy={cy} r="5.5" fill="#4A6B52" stroke="white" strokeWidth="1.5" />
            {/* Dose chip: product + dose, the thing actually stored per point. */}
            <g className={`fd-chip-${point.side} fd-q${i + 1}`}>
              <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke="#8FB49A" strokeWidth="0.75" />
              <rect x={chipX} y={chipY} width={chipW} height="16" rx="8" fill="white" stroke="#E8D5C8" strokeWidth="1" />
              <text
                x={chipX + chipW / 2}
                y={chipY + 11}
                textAnchor="middle"
                fontSize="7"
                fill="#4A6B52"
                fontFamily="sans-serif"
                fontWeight="600"
              >
                {point.label}
              </text>
            </g>
          </g>
        )
      })}

      <g className="fd-sum">
        <rect x="112" y="248" width="176" height="22" rx="11" fill="#1C2B1E" />
        <text x="200" y="262.5" textAnchor="middle" fontSize="8.5" fill="white" fontFamily="sans-serif" fontWeight="600">
          5 pontos · 40U · 1,8ml
        </text>
      </g>
    </svg>
  )
}

// ─── Antes e depois ─────────────────────────────────────────────────
//
// Scene: the actual feature: detect eye landmarks, auto-align the second
// photo to the first, then compare. The payoff is the rotation snapping into
// place, not a padlock.

/**
 * Photo layer for one card. `x` is the image's left edge; the templates are
 * 263x340, so 126x163 keeps their ratio and leaves a margin inside the
 * 144-wide card. Both layers use the same box, which is what lets the two
 * photos stack into one frame once aligned.
 */
const BA_FACE = { y: 47, width: 126, height: 163 }

function BaPhoto({ x, src }: { x: number; src: string }) {
  return <image href={src} x={x} y={BA_FACE.y} width={BA_FACE.width} height={BA_FACE.height} />
}

export function BeforeAfterDemo() {
  // The showcase keeps its desktop and mobile trees in the DOM at once, so a
  // literal id would give both copies the same clip. The hidden copy's rect
  // doesn't animate (display:none suspends animations), which would freeze the
  // reveal on whichever copy is actually visible.
  const clipId = `ba-after-${useId().replace(/:/g, '')}`

  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes ba-card { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ba-scan {
          0%        { opacity: 0; transform: translateY(0); }
          14%       { opacity: 1; }
          86%       { opacity: 1; }
          100%      { opacity: 0; transform: translateY(160px); }
        }
        @keyframes ba-eye  { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: scale(1); } }
        @keyframes ba-fade { from { opacity: 0; } to { opacity: 1; } }
        /* The money moment: the misaligned photo rotates home and settles. */
        @keyframes ba-align {
          0%, 36%   { transform: translateY(6px) rotate(4deg); }
          44.6%     { transform: translateY(-1.2px) rotate(-0.8deg); }
          48.8%     { transform: translateY(0.4px) rotate(0.25deg); }
          51.2%, 100% { transform: translateY(0) rotate(0deg); }
        }
        @keyframes ba-chip { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }

        /* Alignment done, the two frames slide into one stack: 32..176 and
           224..368 both land on 128..272. Aligned, the faces superimpose
           exactly, which is what makes the stack read as a single photo. */
        @keyframes ba-mergeL { 0%, 60% { transform: translateX(0); } 72%, 100% { transform: translateX(96px); } }
        @keyframes ba-mergeR { 0%, 60% { transform: translateX(0); } 72%, 100% { transform: translateX(-96px); } }

        /* Landmarks and guides are scaffolding: they earned the alignment,
           then get out of the way before the comparison. */
        @keyframes ba-scaffold { 0%, 56% { opacity: 1; } 64%, 100% { opacity: 0; } }

        /* Drives the handle and the reveal clip with identical values, so the
           "depois" layer always ends exactly under the handle. */
        @keyframes ba-sweep {
          0%, 72%   { opacity: 0; transform: translateX(128px); }
          76%       { opacity: 1; transform: translateX(140px); }
          92%, 100% { opacity: 1; transform: translateX(203px); }
        }

        .ba-card { opacity: 0; animation: ba-card 0.5s var(--e-out) forwards; }
        .ba-k2   { animation-delay: 0.08s; }

        .ba-scan  { opacity: 0; animation: ba-scan 0.6s var(--e-io) 0.5s forwards; }
        .ba-align { animation: ba-align 5s var(--e-io) forwards; transform-origin: 295px 132px; }

        .ba-eye { opacity: 0; animation: ba-eye 0.4s var(--e-pop) forwards; transform-box: fill-box; transform-origin: center; }
        .ba-e1 { animation-delay: 1.00s; } .ba-e2 { animation-delay: 1.07s; }
        .ba-e3 { animation-delay: 1.14s; } .ba-e4 { animation-delay: 1.21s; }

        .ba-guide { opacity: 0; animation: ba-fade 0.4s var(--e-out) 1.4s forwards; }
        .ba-join  { opacity: 0; animation: ba-fade 0.35s var(--e-out) 2.5s forwards; }
        .ba-chip  { opacity: 0; animation: ba-chip 0.45s var(--e-pop) 2.6s forwards; transform-box: fill-box; transform-origin: center; }

        .ba-scaffold { animation: ba-scaffold 5s linear forwards; }
        .ba-mergeL   { animation: ba-mergeL 5s var(--e-io) forwards; }
        .ba-mergeR   { animation: ba-mergeR 5s var(--e-io) forwards; }
        .ba-sweep    { opacity: 0; animation: ba-sweep 5s var(--e-io) forwards; }
        .ba-tag      { opacity: 0; animation: ba-fade 0.4s var(--e-out) 4s forwards; }

        @media (prefers-reduced-motion: reduce) {
          .ba-card, .ba-scan, .ba-align, .ba-eye, .ba-guide, .ba-join, .ba-chip,
          .ba-scaffold, .ba-mergeL, .ba-mergeR, .ba-sweep, .ba-tag { animation: none; }
          .ba-card, .ba-chip, .ba-tag { opacity: 1; transform: none; }
          .ba-align { transform: none; }
          .ba-scan, .ba-scaffold { opacity: 0; }
          .ba-mergeL { transform: translateX(96px); }
          .ba-mergeR { transform: translateX(-96px); }
          .ba-sweep  { opacity: 1; transform: translateX(203px); }
        }
      `}</style>

      <defs>
        {/*
          Reveals the "depois" layer to the right of the handle. The rect is
          280 wide so that before the sweep starts it still covers the frame in
          its pre-merge position (224..368) and nothing gets clipped early.
        */}
        <clipPath id={clipId}>
          <rect className="ba-sweep" x="0" y="0" width="280" height="280" />
        </clipPath>
      </defs>

      <text x="16" y="26" fontSize="11" fill="#1C2B1E" fontFamily="sans-serif" fontWeight="600">Antes e depois</text>

      {/* "Antes": the base layer of the final stack, with expression lines. */}
      <g className="ba-card">
        <g className="ba-mergeL">
          <rect x="32" y="44" width="144" height="168" rx="10" fill="#FAF7F3" stroke="#E8D5C8" strokeWidth="1" />
          <BaPhoto x={41} src={FACE_SRC_ANTES} />
          <g className="ba-scaffold">
            <line className="ba-guide" x1="60" y1="132" x2="146" y2="132" stroke="#4A6B52" strokeWidth="1" strokeDasharray="4 3" />
            <circle className="ba-eye ba-e1" cx="82" cy="132" r="3.5" fill="#4A6B52" />
            <circle className="ba-eye ba-e2" cx="123" cy="132" r="3.5" fill="#4A6B52" />
          </g>
        </g>
      </g>

      {/*
        "Depois". The clip lives outside every animated transform: clipPath
        coordinates resolve in the referencing element's space, so nesting it
        under the merge or align groups would drag the clip along with them.
        Entrance, merge and alignment then get a group each so the transforms
        don't fight.
      */}
      <g clipPath={`url(#${clipId})`}>
        <g className="ba-card ba-k2">
          <g className="ba-mergeR">
            <g className="ba-align">
              <rect x="224" y="44" width="144" height="168" rx="10" fill="#FAF7F3" stroke="#E8D5C8" strokeWidth="1" />
              <BaPhoto x={233} src={FACE_SRC} />
              <g className="ba-scaffold">
                <line className="ba-guide" x1="252" y1="132" x2="338" y2="132" stroke="#4A6B52" strokeWidth="1" strokeDasharray="4 3" />
                <circle className="ba-eye ba-e3" cx="274" cy="132" r="3.5" fill="#4A6B52" />
                <circle className="ba-eye ba-e4" cx="315" cy="132" r="3.5" fill="#4A6B52" />
              </g>
            </g>
          </g>
        </g>
      </g>

      {/* Bridges the two guides into one continuous eye line once aligned. */}
      <g className="ba-scaffold">
        <line className="ba-join" x1="146" y1="132" x2="252" y2="132" stroke="#4A6B52" strokeWidth="1" strokeDasharray="4 3" />
      </g>

      <g className="ba-scan">
        <rect x="32" y="44" width="144" height="10" rx="2" fill="#4A6B52" opacity="0.18" />
        <rect x="224" y="44" width="144" height="10" rx="2" fill="#4A6B52" opacity="0.18" />
        <line x1="32" y1="48" x2="176" y2="48" stroke="#4A6B52" strokeWidth="1.5" opacity="0.5" />
        <line x1="224" y1="48" x2="368" y2="48" stroke="#4A6B52" strokeWidth="1.5" opacity="0.5" />
      </g>

      {/* Captions travel with their frame, then hand off to the corner tags. */}
      <g className="ba-scaffold">
        <g className="ba-mergeL">
          <text x="104" y="228" textAnchor="middle" fontSize="9" fill="#7A7A7A" fontFamily="sans-serif">Antes</text>
        </g>
        <g className="ba-mergeR">
          <text x="296" y="228" textAnchor="middle" fontSize="9" fill="#7A7A7A" fontFamily="sans-serif">Depois</text>
        </g>
      </g>

      <g className="ba-chip">
        <rect x="150" y="240" width="100" height="22" rx="11" fill="#4A6B52" />
        <path d="M169 251 L173 255 L181 246" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text x="212" y="254.5" textAnchor="middle" fontSize="8.5" fill="white" fontFamily="sans-serif" fontWeight="600">
          Alinhado
        </text>
      </g>

      {/* Corner tags name each half of the merged frame. */}
      <g className="ba-tag">
        <rect x="136" y="190" width="36" height="14" rx="7" fill="#1C2B1E" opacity="0.55" />
        <text x="154" y="200" textAnchor="middle" fontSize="7.5" fill="white" fontFamily="sans-serif" fontWeight="600">Antes</text>
        <rect x="226" y="190" width="40" height="14" rx="7" fill="#1C2B1E" opacity="0.55" />
        <text x="246" y="200" textAnchor="middle" fontSize="7.5" fill="white" fontFamily="sans-serif" fontWeight="600">Depois</text>
      </g>

      {/* Comparison handle, drawn at x=0 and translated so only transform animates. */}
      <g className="ba-sweep">
        <line x1="0" y1="48" x2="0" y2="208" stroke="#4A6B52" strokeWidth="1.5" />
        <circle cx="0" cy="128" r="9" fill="white" stroke="#4A6B52" strokeWidth="1.5" />
        <path d="M-3 124 L-6 128 L-3 132 M3 124 L6 128 L3 132" stroke="#4A6B52" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}

// ─── Captura guiada ─────────────────────────────────────────────────
//
// Scene: pose guide → lock → auto-take → annotate. The annotation pass (arrow,
// circle, ruler) is half the feature and was missing from v1.

export function GuidedCaptureDemo() {
  return (
    <svg viewBox="0 0 400 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="w-full h-full">
      <style>{`
        @keyframes gc-in    { from { opacity: 0; } to { opacity: 1; } }
        @keyframes gc-out   { from { opacity: 1; } to { opacity: 0; } }
        /* A person moving into frame: decelerate and stop. No bounce. */
        @keyframes gc-face  { from { opacity: 0; transform: translate(12px, 48px); } to { opacity: 1; transform: translate(0, 0); } }
        @keyframes gc-lock  { 0% { opacity: 0; transform: scale(1.07); } 30% { opacity: 1; } 100% { opacity: 1; transform: scale(1); } }
        @keyframes gc-flash { 0% { opacity: 0; } 45% { opacity: 0.55; } 100% { opacity: 0; } }
        @keyframes gc-shot  { 0% { transform: scale(1); } 34% { transform: scale(0.962); } 100% { transform: scale(1); } }
        /* "Alinhado" is framing feedback, not a result: it confirms the pose,
           survives the shutter, then clears so the annotations own the frame. */
        @keyframes gc-chip {
          0%        { opacity: 0; transform: scale(0.75); }
          22%       { opacity: 1; transform: scale(1); }
          62%       { opacity: 1; transform: scale(1); }
          78%, 100% { opacity: 0; transform: scale(1); }
        }
        @keyframes gc-arrow { from { stroke-dashoffset: 92; } to { stroke-dashoffset: 0; } }
        @keyframes gc-circ  { from { stroke-dashoffset: 101; } to { stroke-dashoffset: 0; } }
        @keyframes gc-rule  { from { stroke-dashoffset: 78; } to { stroke-dashoffset: 0; } }
        @keyframes gc-tip   { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
        @keyframes gc-meas  { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

        .gc-frame  { opacity: 0; animation: gc-in 0.35s var(--e-out) forwards, gc-shot 0.5s var(--e-out) 1.88s forwards; transform-origin: 200px 140px; }
        .gc-face   { opacity: 0; animation: gc-face 1s var(--e-out) 0.3s forwards; }
        .gc-dashed { animation: gc-out 0.18s linear 1.35s forwards; }
        .gc-solid  { opacity: 0; animation: gc-lock 0.4s var(--e-out) 1.35s forwards; transform-box: fill-box; transform-origin: center; }
        /* Wraps the locked oval so the post-capture fade is its own transform stack. */
        .gc-guide  { animation: gc-out 0.25s var(--e-out) 1.78s forwards; }
        .gc-chip   { opacity: 0; animation: gc-chip 1s var(--e-pop) 1.4s forwards; transform-box: fill-box; transform-origin: center; }
        .gc-flash  { opacity: 0; animation: gc-flash 0.18s linear 1.6s forwards; }

        .gc-arrow { stroke-dasharray: 92; stroke-dashoffset: 92; animation: gc-arrow 0.45s var(--e-out) 2.3s forwards; }
        .gc-tip   { opacity: 0; animation: gc-tip 0.3s var(--e-pop) 2.68s forwards; transform-box: fill-box; transform-origin: center; }
        .gc-circ  { stroke-dasharray: 101; stroke-dashoffset: 101; animation: gc-circ 0.55s var(--e-out) 2.55s forwards; }
        .gc-rule  { stroke-dasharray: 78; stroke-dashoffset: 78; animation: gc-rule 0.4s var(--e-out) 2.8s forwards; }
        .gc-meas  { opacity: 0; animation: gc-meas 0.35s var(--e-out) 3.1s forwards; }

        @media (prefers-reduced-motion: reduce) {
          .gc-frame, .gc-face, .gc-dashed, .gc-solid, .gc-guide, .gc-chip,
          .gc-flash, .gc-arrow, .gc-tip, .gc-circ, .gc-rule, .gc-meas { animation: none; }
          .gc-frame, .gc-face, .gc-tip, .gc-meas { opacity: 1; transform: none; }
          .gc-dashed, .gc-guide, .gc-flash, .gc-chip { opacity: 0; }
          .gc-arrow, .gc-circ, .gc-rule { stroke-dashoffset: 0; }
        }
      `}</style>

      <g className="gc-frame">
        <rect x="70" y="24" width="260" height="232" rx="12" fill="white" stroke="#1C2B1E" strokeWidth="2" />
        <path d="M80 56 V38 H98" stroke="#4A6B52" strokeWidth="2.5" fill="none" />
        <path d="M320 56 V38 H302" stroke="#4A6B52" strokeWidth="2.5" fill="none" />
        <path d="M80 224 V242 H98" stroke="#4A6B52" strokeWidth="2.5" fill="none" />
        <path d="M320 224 V242 H302" stroke="#4A6B52" strokeWidth="2.5" fill="none" />

        {/* Pose guide: mint dashed while unaligned, sage solid once locked. */}
        <ellipse className="gc-dashed" cx="200" cy="124" rx="48" ry="70" stroke="#8FB49A" strokeWidth="2" strokeDasharray="6 4" fill="none" />
        <g className="gc-guide">
          <ellipse className="gc-solid" cx="200" cy="124" rx="48" ry="70" stroke="#4A6B52" strokeWidth="2.5" fill="none" />
        </g>

        {/* Sized to sit inside the pose guide, so "alinhado" is legible. */}
        <g className="gc-face">
          <image href={FACE_SRC} x="132" y="36" width="136" height="176" />
        </g>

        <g className="gc-chip">
          <rect x="158" y="226" width="84" height="20" rx="10" fill="#4A6B52" />
          <path d="M170 236 L174 240 L181 231" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <text x="209" y="240" textAnchor="middle" fontSize="8.5" fill="white" fontFamily="sans-serif" fontWeight="600">
            Alinhado
          </text>
        </g>

        <rect className="gc-flash" x="70" y="24" width="260" height="232" rx="12" fill="white" />

        {/* Annotation pass, drawn onto the captured photo: the circle sits on
            the left nasolabial fold, the ruler measures below the chin. */}
        <path className="gc-arrow" d="M284 208 L198 177" stroke="#4A6B52" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path className="gc-tip" d="M198 177 L211 178 M198 177 L203 189" stroke="#4A6B52" strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle className="gc-circ" cx="184" cy="163" r="16" stroke="#4A6B52" strokeWidth="2" fill="none" />
        <line className="gc-rule" x1="164" y1="228" x2="236" y2="228" stroke="#4A6B52" strokeWidth="2" strokeLinecap="round" />
        <g className="gc-meas">
          <path d="M164 222 V234 M236 222 V234" stroke="#4A6B52" strokeWidth="1.5" strokeLinecap="round" />
          <text x="200" y="219" textAnchor="middle" fontSize="8.5" fill="#4A6B52" fontFamily="sans-serif" fontWeight="600">
            12 mm
          </text>
        </g>
      </g>
    </svg>
  )
}

export function Hero() {
  return (
    <section className="relative bg-cream pt-32 pb-20 md:pt-44 md:pb-40 overflow-hidden">
      {/* Decorative botanical SVG — left */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute -left-16 top-16 w-[260px] md:w-[360px] h-auto opacity-[0.07]"
        viewBox="0 0 360 520"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Main curving stem */}
        <path
          d="M180 510 C180 420 140 360 120 300 C100 240 110 180 140 130 C160 95 170 60 160 20"
          stroke="#4A6B52"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* Left leaves */}
        <path
          d="M140 130 C100 120 60 140 40 180 C60 160 100 150 140 130Z"
          stroke="#4A6B52"
          strokeWidth="1"
          fill="#4A6B52"
          fillOpacity="0.04"
        />
        <path
          d="M120 220 C80 200 30 210 10 250 C40 235 80 225 120 220Z"
          stroke="#4A6B52"
          strokeWidth="1"
          fill="#4A6B52"
          fillOpacity="0.04"
        />
        <path
          d="M125 310 C90 295 50 310 30 345 C55 330 90 315 125 310Z"
          stroke="#4A6B52"
          strokeWidth="1"
          fill="#4A6B52"
          fillOpacity="0.04"
        />
        {/* Right leaves */}
        <path
          d="M160 80 C200 60 240 70 260 100 C230 85 195 80 160 80Z"
          stroke="#4A6B52"
          strokeWidth="1"
          fill="#4A6B52"
          fillOpacity="0.04"
        />
        <path
          d="M130 180 C170 160 220 170 245 200 C210 185 170 178 130 180Z"
          stroke="#4A6B52"
          strokeWidth="1"
          fill="#4A6B52"
          fillOpacity="0.04"
        />
        <path
          d="M115 270 C155 250 200 260 225 290 C195 275 155 268 115 270Z"
          stroke="#4A6B52"
          strokeWidth="1"
          fill="#4A6B52"
          fillOpacity="0.04"
        />
        {/* Leaf veins */}
        <path d="M140 130 C115 145 80 160 40 180" stroke="#4A6B52" strokeWidth="0.5" opacity="0.5" />
        <path d="M120 220 C95 230 55 240 10 250" stroke="#4A6B52" strokeWidth="0.5" opacity="0.5" />
        <path d="M160 80 C195 80 235 88 260 100" stroke="#4A6B52" strokeWidth="0.5" opacity="0.5" />
      </svg>

      {/* Decorative botanical SVG — right */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 top-24 w-[220px] md:w-[320px] h-auto opacity-[0.07]"
        viewBox="0 0 320 480"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Main stem curving the other way */}
        <path
          d="M160 470 C160 390 190 330 200 270 C210 210 195 150 170 110 C155 85 150 50 160 10"
          stroke="#4A6B52"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* Right leaves */}
        <path
          d="M170 110 C210 95 250 110 270 145 C240 130 210 118 170 110Z"
          stroke="#4A6B52"
          strokeWidth="1"
          fill="#4A6B52"
          fillOpacity="0.04"
        />
        <path
          d="M195 200 C235 185 275 195 295 230 C265 215 230 205 195 200Z"
          stroke="#4A6B52"
          strokeWidth="1"
          fill="#4A6B52"
          fillOpacity="0.04"
        />
        <path
          d="M200 290 C235 275 270 285 290 315 C260 300 230 292 200 290Z"
          stroke="#4A6B52"
          strokeWidth="1"
          fill="#4A6B52"
          fillOpacity="0.04"
        />
        {/* Left leaves */}
        <path
          d="M155 160 C115 145 75 155 55 185 C85 172 120 162 155 160Z"
          stroke="#4A6B52"
          strokeWidth="1"
          fill="#4A6B52"
          fillOpacity="0.04"
        />
        <path
          d="M190 250 C150 235 110 245 90 275 C120 262 155 252 190 250Z"
          stroke="#4A6B52"
          strokeWidth="1"
          fill="#4A6B52"
          fillOpacity="0.04"
        />
        {/* Small circular berries/buds */}
        <circle cx="270" cy="145" r="3" stroke="#4A6B52" strokeWidth="0.8" fill="none" />
        <circle cx="55" cy="185" r="3" stroke="#4A6B52" strokeWidth="0.8" fill="none" />
        <circle cx="295" cy="230" r="2.5" stroke="#4A6B52" strokeWidth="0.8" fill="none" />
      </svg>

      <div className="mx-auto max-w-[1200px] px-6">
        <div className="max-w-3xl mx-auto text-center">
          {/* Tagline */}
          <p className="section-label mb-6 animate-fade-up animate-delay-0">
            Gestão clínica exclusiva para Harmonização Orofacial
          </p>

          {/* Headline */}
          <h1 className="text-4xl md:text-[4rem] md:leading-[1.1] leading-tight mb-6 animate-fade-up animate-delay-100">
            Pare de adaptar sistemas genéricos ao seu fluxo de HOF.
          </h1>

          {/* Subtitle */}
          <p className="text-lg md:text-xl text-charcoal/80 leading-relaxed mb-10 max-w-2xl mx-auto animate-fade-up animate-delay-200">
            Diagrama facial, antes e depois com alinhamento automático, fluxo
            guiado de atendimento, financeiro, CRM e confirmação automática de
            consultas — tudo num só lugar.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10 animate-fade-up animate-delay-300">
            <a href="https://app.floraclin.com.br/signup" className="btn-primary text-base px-10 py-4">
              Testar Grátis por 14 Dias
            </a>
            <a
              href="https://wa.me/5547936182197?text=Ol%C3%A1%2C%20gostaria%20de%20agendar%20uma%20demonstra%C3%A7%C3%A3o%20da%20FloraClin."
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-base px-10 py-4"
            >
              Agendar uma Demo
            </a>
          </div>

          {/* Social proof */}
          <p className="text-sm text-mid mb-14 animate-fade-up animate-delay-400">
            Usado por clínicas de HOF em todo o Brasil
          </p>

          {/* Product mockup — stylized browser frame */}
          <div className="animate-fade-up animate-delay-400 mx-auto max-w-3xl">
            <div className="rounded-xl border border-sage/15 bg-white/60 shadow-lg shadow-forest/5 overflow-hidden">
              {/* Browser chrome bar */}
              <div className="flex items-center gap-2 px-4 py-3 bg-petal/50 border-b border-sage/10">
                <span className="w-2.5 h-2.5 rounded-full bg-sage/20" />
                <span className="w-2.5 h-2.5 rounded-full bg-sage/20" />
                <span className="w-2.5 h-2.5 rounded-full bg-sage/20" />
                <div className="ml-3 flex-1 h-5 rounded bg-sage/8 max-w-[220px]" />
              </div>

              {/* Dashboard wireframe */}
              <svg
                aria-hidden="true"
                className="pointer-events-none w-full h-auto"
                viewBox="0 0 720 400"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                {/* Background */}
                <rect width="720" height="400" fill="#FAF7F3" />

                {/* Sidebar */}
                <rect x="0" y="0" width="160" height="400" fill="#1C2B1E" fillOpacity="0.05" />
                {/* Sidebar logo placeholder */}
                <rect x="20" y="20" width="120" height="16" rx="4" fill="#4A6B52" fillOpacity="0.15" />
                {/* Sidebar nav items */}
                <rect x="20" y="56" width="100" height="10" rx="3" fill="#4A6B52" fillOpacity="0.12" />
                <rect x="20" y="78" width="80" height="10" rx="3" fill="#4A6B52" fillOpacity="0.08" />
                <rect x="20" y="100" width="110" height="10" rx="3" fill="#4A6B52" fillOpacity="0.08" />
                <rect x="20" y="122" width="70" height="10" rx="3" fill="#4A6B52" fillOpacity="0.08" />
                <rect x="20" y="144" width="90" height="10" rx="3" fill="#4A6B52" fillOpacity="0.08" />
                {/* Active indicator */}
                <rect x="0" y="52" width="3" height="18" rx="1.5" fill="#4A6B52" fillOpacity="0.3" />

                {/* Header bar */}
                <rect x="160" y="0" width="560" height="48" fill="#FFFFFF" fillOpacity="0.6" />
                <line x1="160" y1="48" x2="720" y2="48" stroke="#4A6B52" strokeOpacity="0.08" />
                <rect x="180" y="16" width="140" height="14" rx="4" fill="#1C2B1E" fillOpacity="0.08" />
                <circle cx="680" cy="24" r="14" fill="#4A6B52" fillOpacity="0.08" />

                {/* Stats cards row */}
                <rect x="180" y="68" width="120" height="70" rx="8" fill="#FFFFFF" stroke="#4A6B52" strokeOpacity="0.08" />
                <rect x="196" y="82" width="50" height="8" rx="2" fill="#4A6B52" fillOpacity="0.12" />
                <rect x="196" y="100" width="70" height="16" rx="3" fill="#1C2B1E" fillOpacity="0.1" />

                <rect x="316" y="68" width="120" height="70" rx="8" fill="#FFFFFF" stroke="#4A6B52" strokeOpacity="0.08" />
                <rect x="332" y="82" width="50" height="8" rx="2" fill="#4A6B52" fillOpacity="0.12" />
                <rect x="332" y="100" width="60" height="16" rx="3" fill="#1C2B1E" fillOpacity="0.1" />

                <rect x="452" y="68" width="120" height="70" rx="8" fill="#FFFFFF" stroke="#4A6B52" strokeOpacity="0.08" />
                <rect x="468" y="82" width="50" height="8" rx="2" fill="#4A6B52" fillOpacity="0.12" />
                <rect x="468" y="100" width="75" height="16" rx="3" fill="#1C2B1E" fillOpacity="0.1" />

                <rect x="588" y="68" width="112" height="70" rx="8" fill="#FFFFFF" stroke="#4A6B52" strokeOpacity="0.08" />
                <rect x="604" y="82" width="50" height="8" rx="2" fill="#4A6B52" fillOpacity="0.12" />
                <rect x="604" y="100" width="55" height="16" rx="3" fill="#1C2B1E" fillOpacity="0.1" />

                {/* Face diagram area */}
                <rect x="180" y="158" width="280" height="220" rx="10" fill="#FFFFFF" stroke="#4A6B52" strokeOpacity="0.1" />
                <text x="195" y="180" fontSize="9" fill="#4A6B52" fillOpacity="0.3" fontFamily="sans-serif">Diagrama Facial</text>

                {/* Simplified face outline */}
                <ellipse cx="320" cy="280" rx="55" ry="70" stroke="#4A6B52" strokeOpacity="0.15" strokeWidth="1.5" fill="none" />
                {/* Eyes */}
                <ellipse cx="300" cy="265" rx="12" ry="5" stroke="#4A6B52" strokeOpacity="0.12" strokeWidth="1" fill="none" />
                <ellipse cx="340" cy="265" rx="12" ry="5" stroke="#4A6B52" strokeOpacity="0.12" strokeWidth="1" fill="none" />
                {/* Nose */}
                <path d="M320 275 L315 290 L325 290Z" stroke="#4A6B52" strokeOpacity="0.12" strokeWidth="1" fill="none" />
                {/* Mouth */}
                <path d="M307 300 Q320 310 333 300" stroke="#4A6B52" strokeOpacity="0.12" strokeWidth="1" fill="none" />
                {/* Injection points */}
                <circle cx="295" cy="255" r="3" fill="#4A6B52" fillOpacity="0.2" />
                <circle cx="345" cy="255" r="3" fill="#4A6B52" fillOpacity="0.2" />
                <circle cx="308" cy="302" r="3" fill="#4A6B52" fillOpacity="0.2" />
                <circle cx="332" cy="302" r="3" fill="#4A6B52" fillOpacity="0.2" />
                <circle cx="310" cy="240" r="2.5" fill="#8FB49A" fillOpacity="0.3" />
                <circle cx="330" cy="240" r="2.5" fill="#8FB49A" fillOpacity="0.3" />

                {/* Right panel — patient list / schedule */}
                <rect x="480" y="158" width="220" height="220" rx="10" fill="#FFFFFF" stroke="#4A6B52" strokeOpacity="0.1" />
                <text x="495" y="180" fontSize="9" fill="#4A6B52" fillOpacity="0.3" fontFamily="sans-serif">Agenda</text>

                {/* Schedule rows */}
                <rect x="495" y="194" width="190" height="28" rx="6" fill="#4A6B52" fillOpacity="0.04" />
                <rect x="505" y="202" width="60" height="8" rx="2" fill="#4A6B52" fillOpacity="0.12" />
                <rect x="635" y="202" width="40" height="8" rx="2" fill="#8FB49A" fillOpacity="0.2" />

                <rect x="495" y="230" width="190" height="28" rx="6" fill="#4A6B52" fillOpacity="0.04" />
                <rect x="505" y="238" width="75" height="8" rx="2" fill="#4A6B52" fillOpacity="0.12" />
                <rect x="635" y="238" width="40" height="8" rx="2" fill="#8FB49A" fillOpacity="0.2" />

                <rect x="495" y="266" width="190" height="28" rx="6" fill="#4A6B52" fillOpacity="0.06" />
                <rect x="505" y="274" width="55" height="8" rx="2" fill="#4A6B52" fillOpacity="0.12" />
                <rect x="635" y="274" width="40" height="8" rx="2" fill="#E8D5C8" fillOpacity="0.4" />

                <rect x="495" y="302" width="190" height="28" rx="6" fill="#4A6B52" fillOpacity="0.04" />
                <rect x="505" y="310" width="65" height="8" rx="2" fill="#4A6B52" fillOpacity="0.12" />
                <rect x="635" y="310" width="40" height="8" rx="2" fill="#8FB49A" fillOpacity="0.2" />

                <rect x="495" y="338" width="190" height="28" rx="6" fill="#4A6B52" fillOpacity="0.04" />
                <rect x="505" y="346" width="70" height="8" rx="2" fill="#4A6B52" fillOpacity="0.12" />
                <rect x="635" y="346" width="40" height="8" rx="2" fill="#8FB49A" fillOpacity="0.2" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

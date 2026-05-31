export function CtaBanner() {
  return (
    <section className="relative bg-gradient-to-br from-forest to-sage/90 py-16 md:py-32 overflow-hidden">
      {/* Botanical line drawing — right side */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 top-1/2 -translate-y-1/2 w-[240px] md:w-[360px] h-auto opacity-[0.08]"
        viewBox="0 0 360 400"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Main branch curving from bottom-right upward */}
        <path
          d="M320 390 C300 340 260 290 230 250 C200 210 190 170 200 130 C210 95 210 60 195 20"
          stroke="#FAF7F3"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* Leaves branching right */}
        <path
          d="M230 250 C270 235 300 245 320 275 C290 260 260 252 230 250Z"
          stroke="#FAF7F3"
          strokeWidth="1"
          fill="#FAF7F3"
          fillOpacity="0.05"
        />
        <path
          d="M210 180 C250 165 285 175 305 200 C275 188 245 180 210 180Z"
          stroke="#FAF7F3"
          strokeWidth="1"
          fill="#FAF7F3"
          fillOpacity="0.05"
        />
        <path
          d="M200 130 C235 115 265 125 285 150 C260 138 230 130 200 130Z"
          stroke="#FAF7F3"
          strokeWidth="1"
          fill="#FAF7F3"
          fillOpacity="0.05"
        />
        {/* Leaves branching left */}
        <path
          d="M250 300 C215 285 180 295 160 325 C190 310 220 302 250 300Z"
          stroke="#FAF7F3"
          strokeWidth="1"
          fill="#FAF7F3"
          fillOpacity="0.05"
        />
        <path
          d="M215 210 C180 195 145 205 125 235 C155 220 185 212 215 210Z"
          stroke="#FAF7F3"
          strokeWidth="1"
          fill="#FAF7F3"
          fillOpacity="0.05"
        />
        {/* Leaf veins */}
        <path d="M230 250 C260 248 295 258 320 275" stroke="#FAF7F3" strokeWidth="0.5" opacity="0.5" />
        <path d="M210 180 C240 178 270 185 305 200" stroke="#FAF7F3" strokeWidth="0.5" opacity="0.5" />
        <path d="M250 300 C225 298 195 305 160 325" stroke="#FAF7F3" strokeWidth="0.5" opacity="0.5" />
        {/* Small buds */}
        <circle cx="195" cy="20" r="3" stroke="#FAF7F3" strokeWidth="0.8" fill="none" />
        <circle cx="320" cy="275" r="2.5" stroke="#FAF7F3" strokeWidth="0.8" fill="none" />
        <circle cx="125" cy="235" r="2.5" stroke="#FAF7F3" strokeWidth="0.8" fill="none" />
      </svg>

      <div className="relative mx-auto max-w-[1200px] px-6 text-center">
        <h2 className="text-3xl md:text-[2.5rem] md:leading-tight text-cream mb-6">
          Pronto pra parar de improvisar?
        </h2>

        <p className="text-cream/70 text-lg md:text-xl max-w-xl mx-auto mb-10 leading-relaxed">
          14 dias grátis. Sem cartão. Sem compromisso.
        </p>

        <a
          href="https://app.floraclin.com.br/signup"
          className="btn-primary bg-cream text-forest hover:bg-blush inline-flex text-base px-10 py-4"
        >
          Começar Grátis
        </a>
      </div>
    </section>
  );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex bg-cream">
      {/* Left panel — rich branded visual (desktop only) */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-forest items-center justify-center">
        {/* Gradient mesh overlay */}
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse at 20% 50%, rgba(74, 107, 82, 0.6) 0%, transparent 60%),
              radial-gradient(ellipse at 80% 20%, rgba(143, 180, 154, 0.3) 0%, transparent 50%),
              radial-gradient(ellipse at 60% 80%, rgba(196, 168, 130, 0.15) 0%, transparent 50%),
              linear-gradient(135deg, #1C2B1E 0%, #2a3f2e 50%, #1C2B1E 100%)
            `,
          }}
        />

        {/* CSS botanical element */}
        <div className="relative z-10 flex flex-col items-center animate-fade-in">
          {/* Decorative botanical circles */}
          <div className="relative w-48 h-48 mb-8 animate-botanical-sway">
            <div className="absolute inset-0 rounded-full border border-mint/20" />
            <div className="absolute inset-4 rounded-full border border-mint/15" />
            <div className="absolute inset-8 rounded-full border border-mint/10" />
            <div className="absolute inset-12 rounded-full border border-gold/10" />
            {/* Leaf-like shapes via CSS */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-24 rounded-[50%] border border-mint/30 rotate-12" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-24 rounded-[50%] border border-mint/20 -rotate-12" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-20 bg-mint/15 rounded-full" />
          </div>

          {/* Brand on visual panel */}
          <h1 className="font-display text-5xl font-semibold tracking-tight">
            <span className="text-cream">Flora</span>
            <span className="text-mint">Clin</span>
          </h1>
          <p className="mt-3 text-cream/50 text-sm tracking-[0.25em] uppercase">
            Gestão &middot; HOF &amp; Estética
          </p>
          <p className="mt-8 text-cream/40 text-sm max-w-xs text-center leading-relaxed">
            Plataforma completa para gestão de clínicas de harmonização e estética
          </p>
        </div>

        {/* Decorative dots pattern */}
        <div className="absolute bottom-0 left-0 right-0 h-32 opacity-[0.03]" style={{
          backgroundImage: 'radial-gradient(circle, #FAF7F3 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }} />
      </div>

      {/* Right panel — form area */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 lg:px-12">
        <div className="w-full max-w-md">
          {children}
        </div>

        {/* Footer */}
        <p className="mt-12 text-gold/60 text-[11px] tracking-wider">
          floraclin.com.br
        </p>
      </div>
    </div>
  )
}

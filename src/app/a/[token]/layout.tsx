export default function AnamnesisPublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            <img src="/brand/logo-sage.svg" alt="" className="h-8" />
            <span className="font-display text-xl font-semibold">
              <span className="text-forest">Flora</span>
              <span className="text-sage">Clin</span>
            </span>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

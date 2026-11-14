export function SettingsSectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <h3 className="uppercase tracking-wider text-xs font-medium text-mid">{children}</h3>
      <div className="flex-1 h-px bg-blush/60" />
    </div>
  )
}

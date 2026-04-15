export function formatRelativeSaveTime(savedAt: Date, now: Date): string {
  const diffMs = now.getTime() - savedAt.getTime()
  if (diffMs < 60_000) return 'Salvo agora'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `Salvo há ${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Salvo há ${hours}h`
  const days = Math.floor(hours / 24)
  return `Salvo há ${days}d`
}

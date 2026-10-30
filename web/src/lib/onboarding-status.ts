export function isOnboardingCompleted(settings: unknown): boolean {
  return (settings as Record<string, unknown> | null | undefined)?.onboarding_completed === true
}

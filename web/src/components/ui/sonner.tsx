"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// Sonner's own edge gaps (desktop / mobile), grown by the notch and
// home-indicator insets so toasts stay clear of them (viewport-fit=cover).
const DESKTOP_EDGE_GAP = "24px"
const MOBILE_EDGE_GAP = "16px"

function safeAreaOffset(gap: string) {
  return {
    top: `calc(${gap} + env(safe-area-inset-top))`,
    right: `calc(${gap} + env(safe-area-inset-right))`,
    bottom: `calc(${gap} + env(safe-area-inset-bottom))`,
    left: `calc(${gap} + env(safe-area-inset-left))`,
  }
}

const DESKTOP_OFFSET = safeAreaOffset(DESKTOP_EDGE_GAP)
const MOBILE_OFFSET = safeAreaOffset(MOBILE_EDGE_GAP)

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      offset={DESKTOP_OFFSET}
      mobileOffset={MOBILE_OFFSET}
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }

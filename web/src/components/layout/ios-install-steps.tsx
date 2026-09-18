'use client'

import Image from 'next/image'
import { Check, Ellipsis, Share, SquarePlus } from 'lucide-react'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

// Safari has no install API, so the sheet walks through the taps by hand. The
// path is the iOS 26 compact toolbar: Share sits behind the "..." button and
// "Adicionar à Tela de Início" behind "Ver mais" in the share sheet.
const STEPS = [
  { icon: Ellipsis, text: 'Toque em ⋯ na barra do Safari' },
  { icon: Share, text: 'Toque em Compartilhar' },
  { icon: SquarePlus, text: 'Toque em Ver mais e depois em Adicionar à Tela de Início' },
  { icon: Check, text: 'Toque em Adicionar' },
]

export function IosInstallSteps({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl px-5 pb-6 pt-5" showCloseButton={false}>
        <SheetHeader className="flex-row items-center gap-3 p-0 text-left">
          <Image src="/apple-icon.png" alt="" width={64} height={64} className="size-16 shrink-0 rounded-[22%] shadow-md" />
          <div>
            <SheetTitle className="text-base">Instale o FloraClin</SheetTitle>
            <SheetDescription>Quatro toques no Safari, sem loja de apps.</SheetDescription>
          </div>
        </SheetHeader>
        <ol className="space-y-3">
          {STEPS.map(({ icon: Icon, text }, index) => (
            <li key={text} className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sage/10 text-forest">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="text-sm text-charcoal">
                <span className="mr-1.5 font-medium text-mid">{index + 1}.</span>
                {text}
              </span>
            </li>
          ))}
        </ol>
        <SheetClose className="w-full rounded-lg bg-forest py-2.5 text-sm font-medium text-white">Entendi</SheetClose>
      </SheetContent>
    </Sheet>
  )
}

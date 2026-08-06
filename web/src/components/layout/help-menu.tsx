'use client'

import { useState, useRef, useEffect } from 'react'
import { HelpCircle, Mail, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const WHATSAPP_NUMBER = '5547936181734'
const SUPPORT_EMAIL = 'contato@floraclin.com.br'

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

export function HelpMenu() {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const openWhatsApp = () => {
    window.open(
      `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Olá! Preciso de ajuda com o FloraClin.')}`,
      '_blank',
    )
    setIsOpen(false)
  }

  const openEmail = () => {
    window.open(`mailto:${SUPPORT_EMAIL}?subject=Ajuda FloraClin`, '_blank')
    setIsOpen(false)
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1.5 p-2 rounded-lg transition-colors duration-200',
          isOpen
            ? 'bg-sage/10 text-forest'
            : 'text-mid hover:text-charcoal hover:bg-sage/5',
        )}
        aria-label="Ajuda"
      >
        {isOpen ? <X className="size-[18px]" /> : <HelpCircle className="size-[18px]" />}
        <span className="hidden md:inline text-sm font-medium">Ajuda</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-lg shadow-lg border border-[#E8ECEF] overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="p-3 border-b border-[#F0F0F0]">
            <p className="text-sm font-medium text-charcoal">Precisa de ajuda?</p>
            <p className="text-xs text-mid mt-0.5">Escolha como prefere falar conosco</p>
          </div>

          <div className="p-2">
            <button
              onClick={openWhatsApp}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#F0F7F1] transition-colors group"
            >
              <div className="w-9 h-9 rounded-lg bg-[#25D366] flex items-center justify-center shrink-0">
                <WhatsAppIcon className="w-5 h-5 text-white" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-charcoal group-hover:text-forest">WhatsApp</p>
                <p className="text-xs text-mid">Resposta rápida</p>
              </div>
            </button>

            <button
              onClick={openEmail}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-sage/5 transition-colors group"
            >
              <div className="w-9 h-9 rounded-lg bg-mid flex items-center justify-center shrink-0">
                <Mail className="w-5 h-5 text-white" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-charcoal group-hover:text-forest">E-mail</p>
                <p className="text-xs text-mid">{SUPPORT_EMAIL}</p>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

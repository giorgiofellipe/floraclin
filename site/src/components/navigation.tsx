"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X } from "lucide-react";

const NAV_LINKS = [
  { href: "#recursos", label: "Recursos" },
  { href: "#como-funciona", label: "Como Funciona" },
  { href: "#precos", label: "Preços" },
  { href: "#contato", label: "Contato" },
];

export function Navigation() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-cream/90 backdrop-blur-md border-b border-sage/10">
      <nav className="mx-auto max-w-[1200px] px-6 flex items-center justify-between h-16 md:h-20">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <Image
            src="/brand/logo-forest.svg"
            alt="FloraClin"
            width={32}
            height={32}
          />
          <span className="font-serif text-xl font-medium text-forest tracking-tight">
            FloraClin
          </span>
        </Link>

        {/* Desktop links */}
        <ul className="hidden md:flex items-center gap-8 list-none m-0 p-0">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="text-sm text-charcoal hover:text-sage transition-colors no-underline"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        {/* Desktop CTA */}
        <a href="#" className="btn-primary hidden md:inline-flex text-sm py-2.5 px-6">
          Começar Grátis
        </a>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 text-forest bg-transparent border-none cursor-pointer"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-cream border-t border-sage/10">
          <div className="px-6 py-6 flex flex-col gap-4">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-base text-charcoal hover:text-sage transition-colors no-underline py-2"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <a
              href="#"
              className="btn-primary text-center mt-2"
              onClick={() => setMobileOpen(false)}
            >
              Começar Grátis
            </a>
          </div>
        </div>
      )}
    </header>
  );
}

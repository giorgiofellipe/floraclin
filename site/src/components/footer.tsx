import Link from "next/link";
import Image from "next/image";

const COLUMNS = [
  {
    title: "Plataforma",
    links: [
      { label: "Agenda", href: "#" },
      { label: "Prontuário", href: "#" },
      { label: "Financeiro", href: "#" },
      { label: "Diagrama Facial", href: "#" },
    ],
  },
  {
    title: "Recursos",
    links: [
      { label: "Assinatura Digital", href: "#" },
      { label: "Agendamento Online", href: "#" },
      { label: "Anamnese Digital", href: "#" },
      { label: "Relatórios", href: "#" },
    ],
  },
  {
    title: "Empresa",
    links: [
      { label: "Sobre", href: "#" },
      { label: "Blog", href: "#" },
      { label: "Contato", href: "#contato" },
      { label: "Carreiras", href: "#" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Termos de Uso", href: "#" },
      { label: "Privacidade", href: "#" },
      { label: "LGPD", href: "#" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-forest text-cream/80 pt-16 md:pt-24 pb-8">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-12 md:gap-8 mb-16">
          {/* Brand column */}
          <div className="md:col-span-1">
            <Link href="/" className="flex items-center gap-2.5 no-underline mb-4">
              <Image
                src="/brand/logo-white.svg"
                alt="FloraClin"
                width={28}
                height={28}
              />
              <span className="font-serif text-lg font-medium text-cream">
                FloraClin
              </span>
            </Link>
            <p className="text-cream/50 text-sm leading-relaxed">
              Onde o cuidado floresce.
            </p>

            {/* Social */}
            <div className="flex items-center gap-4 mt-6">
              <a
                href="#"
                className="text-cream/50 hover:text-cream transition-colors"
                aria-label="Instagram"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="2" width="20" height="20" rx="5" />
                  <circle cx="12" cy="12" r="5" />
                  <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
                </svg>
              </a>
              <a
                href="#"
                className="text-cream/50 hover:text-cream transition-colors"
                aria-label="LinkedIn"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" />
                  <rect x="2" y="9" width="4" height="12" />
                  <circle cx="4" cy="4" r="2" />
                </svg>
              </a>
            </div>
          </div>

          {/* Link columns */}
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h4 className="text-cream text-sm font-sans font-medium uppercase tracking-wider mb-4">
                {column.title}
              </h4>
              <ul className="list-none m-0 p-0 flex flex-col gap-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-cream/50 hover:text-cream text-sm transition-colors no-underline"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="border-t border-cream/10 pt-8">
          <p className="text-cream/30 text-sm text-center">
            &copy; 2026 FloraClin. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </footer>
  );
}

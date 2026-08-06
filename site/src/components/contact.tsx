import { FadeIn } from "./fade-in";

export function Contact() {
  return (
    <section id="contato" className="bg-cream py-16 md:py-24">
      <div className="mx-auto max-w-[1200px] px-6">
        <FadeIn>
          <div className="text-center mb-12">
            <p className="section-label mb-4">Contato</p>
            <h2 className="text-3xl md:text-[2.5rem] md:leading-tight max-w-2xl mx-auto">
              Fale com a gente
            </h2>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 max-w-lg mx-auto">
            <a
              href="https://wa.me/5547936181734"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 bg-white border border-sage/10 rounded-xl px-6 py-4 w-full sm:w-auto hover:border-sage/30 transition-colors no-underline group"
            >
              <svg
                aria-hidden="true"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                className="text-sage shrink-0"
              >
                <path
                  d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"
                  fill="currentColor"
                />
                <path
                  d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.96 9.96 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.96 7.96 0 01-4.11-1.14L4 20l1.14-3.89A7.96 7.96 0 014 12c0-4.41 3.59-8 8-8s8 3.59 8 8-3.59 8-8 8z"
                  fill="currentColor"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-forest group-hover:text-sage transition-colors">
                  WhatsApp
                </p>
                <p className="text-xs text-charcoal/50">
                  +55 47 93618-1734
                </p>
              </div>
            </a>

            <a
              href="mailto:contato@floraclin.com.br"
              className="flex items-center gap-3 bg-white border border-sage/10 rounded-xl px-6 py-4 w-full sm:w-auto hover:border-sage/30 transition-colors no-underline group"
            >
              <svg
                aria-hidden="true"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-sage shrink-0"
              >
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M22 7l-10 7L2 7" />
              </svg>
              <div>
                <p className="text-sm font-medium text-forest group-hover:text-sage transition-colors">
                  E-mail
                </p>
                <p className="text-xs text-charcoal/50">
                  contato@floraclin.com.br
                </p>
              </div>
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

import { Quote } from "lucide-react";

export function Testimonial() {
  return (
    <section className="bg-petal py-16 md:py-32">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="text-center mb-12">
          <p className="section-label mb-4">Depoimentos</p>
        </div>

        <div className="max-w-3xl mx-auto text-center">
          <Quote
            size={40}
            className="text-sage/30 mx-auto mb-8"
          />

          <blockquote className="font-serif text-2xl md:text-3xl leading-snug text-forest mb-8">
            &ldquo;Antes do FloraClin eu controlava tudo no papel e no
            WhatsApp. Hoje tenho visão completa da clínica — agenda,
            financeiro, prontuário — tudo num lugar só. Minha equipe
            agradece.&rdquo;
          </blockquote>

          <div>
            <p className="font-medium text-forest text-lg">
              Dra. Camila Ribeiro
            </p>
            <p className="text-mid text-sm mt-1">
              Proprietária — Clínica Harmonize
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

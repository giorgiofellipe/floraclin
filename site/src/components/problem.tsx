import { FadeIn } from "./fade-in";

const PAIN_POINTS = [
  {
    title: "Sistema genérico, gambiarras infinitas",
    description:
      "Seu software não sabe o que é um diagrama facial. Você adapta, cria planilha paralela, anota no papel — e ainda paga por funcionalidade que não usa.",
    icon: PuzzleIcon,
  },
  {
    title: "Antes e depois não convence",
    description:
      "Fotos desalinhadas, ângulos diferentes, iluminação inconsistente. O resultado é bom, mas a comparação não mostra.",
    icon: CameraIcon,
  },
  {
    title: "Paciente faltou de novo",
    description:
      "Sem confirmação automática, a recepção vive ligando e o paciente esquece. Horário vago é receita perdida.",
    icon: CalendarXIcon,
  },
];

function PuzzleIcon() {
  return (
    <svg
      aria-hidden="true"
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="4" width="24" height="24" rx="4" stroke="#4A6B52" strokeWidth="1.5" />
      <line x1="16" y1="4" x2="16" y2="28" stroke="#4A6B52" strokeWidth="1" strokeDasharray="2 2" />
      <line x1="4" y1="16" x2="28" y2="16" stroke="#4A6B52" strokeWidth="1" strokeDasharray="2 2" />
      <circle cx="16" cy="10" r="3" stroke="#4A6B52" strokeWidth="1" fill="none" />
      <line x1="10" y1="16" x2="10" y2="13" stroke="#4A6B52" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg
      aria-hidden="true"
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="3" y="9" width="26" height="18" rx="3" stroke="#4A6B52" strokeWidth="1.5" />
      <path d="M11 9 L13 5 H19 L21 9" stroke="#4A6B52" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="16" cy="18" r="5" stroke="#4A6B52" strokeWidth="1.5" fill="none" />
      <line x1="12" y1="28" x2="20" y2="28" stroke="#4A6B52" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      <line x1="11" y1="30" x2="21" y2="30" stroke="#4A6B52" strokeWidth="1" strokeLinecap="round" opacity="0.2" />
    </svg>
  );
}

function CalendarXIcon() {
  return (
    <svg
      aria-hidden="true"
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="6" width="24" height="22" rx="3" stroke="#4A6B52" strokeWidth="1.5" />
      <line x1="4" y1="12" x2="28" y2="12" stroke="#4A6B52" strokeWidth="1" />
      <line x1="10" y1="4" x2="10" y2="8" stroke="#4A6B52" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="22" y1="4" x2="22" y2="8" stroke="#4A6B52" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="18" x2="20" y2="24" stroke="#4A6B52" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="20" y1="18" x2="12" y2="24" stroke="#4A6B52" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Problem() {
  return (
    <section className="bg-white py-16 md:py-32">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="text-center mb-16 md:mb-20">
          <p className="section-label mb-4">O Problema</p>
          <h2 className="text-3xl md:text-[2.5rem] md:leading-tight max-w-2xl mx-auto">
            Você não deveria perder tempo lutando contra o próprio sistema.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
          {PAIN_POINTS.map((point) => {
            const Icon = point.icon;
            return (
              <FadeIn key={point.title}>
                <div className="bg-cream rounded-2xl border border-sage/10 p-8">
                  <div className="mb-5">
                    <Icon />
                  </div>
                  <h3 className="text-xl mb-3 text-forest">{point.title}</h3>
                  <p className="text-charcoal/70 leading-relaxed">
                    {point.description}
                  </p>
                </div>
              </FadeIn>
            );
          })}
        </div>
      </div>
    </section>
  );
}

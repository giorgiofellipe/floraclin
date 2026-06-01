import { FadeIn } from "./fade-in";

const STEPS = [
  {
    number: "1",
    title: "Configure em minutos",
    description:
      "Cadastre sua equipe, procedimentos e horários. Modelos de termos e avaliação já vêm prontos.",
  },
  {
    number: "2",
    title: "Paciente chega preparado",
    description:
      "Um link pelo WhatsApp e o paciente agenda, preenche a anamnese e confirma presença. Quando chega, o prontuário já tem tudo.",
  },
  {
    number: "3",
    title: "Atenda e documente sem esforço",
    description:
      "Siga o fluxo guiado: avaliação, diagrama facial, fotos, execução. Tudo registrado automaticamente.",
  },
];

/* Pictogram: clinic/building with a checkmark */
function ConfigurePictogram() {
  return (
    <svg
      aria-hidden="true"
      className="mx-auto mt-6"
      width="72"
      height="72"
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Building */}
      <rect x="16" y="22" width="40" height="34" rx="3" stroke="#4A6B52" strokeWidth="1.3" />
      {/* Roof accent */}
      <path d="M12 25 L36 10 L60 25" stroke="#4A6B52" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      {/* Door */}
      <rect x="30" y="42" width="12" height="14" rx="2" stroke="#4A6B52" strokeWidth="1" />
      {/* Windows */}
      <rect x="22" y="30" width="8" height="7" rx="1.5" stroke="#4A6B52" strokeWidth="1" />
      <rect x="42" y="30" width="8" height="7" rx="1.5" stroke="#4A6B52" strokeWidth="1" />
      {/* Cross (clinic) */}
      <line x1="36" y1="16" x2="36" y2="22" stroke="#4A6B52" strokeWidth="1" />
      <line x1="33" y1="19" x2="39" y2="19" stroke="#4A6B52" strokeWidth="1" />
      {/* Checkmark */}
      <circle cx="56" cy="16" r="8" fill="#FAF7F3" stroke="#4A6B52" strokeWidth="1.2" />
      <path d="M52 16 L55 19 L60 13" stroke="#4A6B52" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* Pictogram: phone with a document/form */
function PatientPictogram() {
  return (
    <svg
      aria-hidden="true"
      className="mx-auto mt-6"
      width="72"
      height="72"
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Phone body */}
      <rect x="20" y="8" width="32" height="56" rx="5" stroke="#4A6B52" strokeWidth="1.3" />
      {/* Screen */}
      <rect x="24" y="16" width="24" height="36" rx="2" stroke="#4A6B52" strokeWidth="0.8" strokeOpacity="0.5" />
      {/* Home indicator */}
      <rect x="32" y="57" width="8" height="2" rx="1" fill="#4A6B52" fillOpacity="0.2" />
      {/* Form lines on screen */}
      <rect x="28" y="21" width="16" height="2" rx="1" fill="#4A6B52" fillOpacity="0.2" />
      <rect x="28" y="27" width="12" height="2" rx="1" fill="#4A6B52" fillOpacity="0.15" />
      <rect x="28" y="33" width="14" height="2" rx="1" fill="#4A6B52" fillOpacity="0.15" />
      <rect x="28" y="39" width="10" height="2" rx="1" fill="#4A6B52" fillOpacity="0.15" />
      {/* Checkbox checked */}
      <rect x="28" y="44" width="5" height="5" rx="1" stroke="#4A6B52" strokeWidth="0.8" />
      <path d="M29 47 L30 48 L32 45.5" stroke="#4A6B52" strokeWidth="0.8" strokeLinecap="round" />
      <rect x="35" y="45" width="10" height="2" rx="1" fill="#4A6B52" fillOpacity="0.15" />
      {/* Small document icon floating to the right */}
      <rect x="50" y="12" width="14" height="18" rx="2" stroke="#4A6B52" strokeWidth="1" fill="#FAF7F3" />
      <path d="M58 12 L64 18" stroke="#4A6B52" strokeWidth="0.8" />
      <path d="M58 12 L58 18 L64 18" stroke="#4A6B52" strokeWidth="0.8" fill="none" />
      <rect x="53" y="22" width="8" height="1.5" rx="0.5" fill="#4A6B52" fillOpacity="0.15" />
      <rect x="53" y="25" width="6" height="1.5" rx="0.5" fill="#4A6B52" fillOpacity="0.15" />
    </svg>
  );
}

/* Pictogram: clipboard with a face diagram outline */
function DocumentPictogram() {
  return (
    <svg
      aria-hidden="true"
      className="mx-auto mt-6"
      width="72"
      height="72"
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Clipboard body */}
      <rect x="14" y="12" width="44" height="54" rx="4" stroke="#4A6B52" strokeWidth="1.3" />
      {/* Clipboard clip */}
      <rect x="28" y="7" width="16" height="10" rx="3" stroke="#4A6B52" strokeWidth="1.2" fill="#FAF7F3" />
      {/* Face outline on clipboard */}
      <ellipse cx="36" cy="42" rx="14" ry="17" stroke="#4A6B52" strokeWidth="1" strokeOpacity="0.6" />
      {/* Eyes */}
      <ellipse cx="31" cy="38" rx="3" ry="1.5" stroke="#4A6B52" strokeWidth="0.8" strokeOpacity="0.5" />
      <ellipse cx="41" cy="38" rx="3" ry="1.5" stroke="#4A6B52" strokeWidth="0.8" strokeOpacity="0.5" />
      {/* Nose */}
      <path d="M36 41 L34 46 L38 46Z" stroke="#4A6B52" strokeWidth="0.7" strokeOpacity="0.5" fill="none" />
      {/* Mouth */}
      <path d="M32 50 Q36 53 40 50" stroke="#4A6B52" strokeWidth="0.7" strokeOpacity="0.5" fill="none" />
      {/* Injection dots */}
      <circle cx="29" cy="35" r="1.5" fill="#4A6B52" fillOpacity="0.25" />
      <circle cx="43" cy="35" r="1.5" fill="#4A6B52" fillOpacity="0.25" />
      <circle cx="33" cy="51" r="1.5" fill="#4A6B52" fillOpacity="0.25" />
      <circle cx="39" cy="51" r="1.5" fill="#4A6B52" fillOpacity="0.25" />
    </svg>
  );
}

const PICTOGRAMS = [ConfigurePictogram, PatientPictogram, DocumentPictogram];

export function HowItWorks() {
  return (
    <section id="como-funciona" className="bg-white py-16 md:py-32">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="text-center mb-16 md:mb-20">
          <p className="section-label mb-4">Como Funciona</p>
          <h2 className="text-3xl md:text-[2.5rem] md:leading-tight">
            Do cadastro ao primeiro atendimento em minutos
          </h2>
        </div>

        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-16">
          {/* Dashed connector line between steps (desktop only) */}
          <div
            className="hidden md:block absolute top-8 border-t-2 border-dashed border-sage/20"
            style={{ left: "16.67%", right: "16.67%" }}
            aria-hidden="true"
          />

          {STEPS.map((step, i) => {
            const Pictogram = PICTOGRAMS[i];
            return (
              <FadeIn key={step.number}>
                <div className="text-center relative">
                  {/* Numbered circle */}
                  <div className="w-16 h-16 rounded-full bg-forest text-cream flex items-center justify-center mx-auto mb-6 relative z-10">
                    <span className="font-serif text-2xl font-medium">
                      {step.number}
                    </span>
                  </div>

                  <h3 className="text-xl md:text-2xl mb-3">{step.title}</h3>
                  <p className="text-charcoal/70 leading-relaxed max-w-xs mx-auto">
                    {step.description}
                  </p>

                  {/* Pictogram illustration */}
                  <Pictogram />
                </div>
              </FadeIn>
            );
          })}
        </div>
      </div>
    </section>
  );
}

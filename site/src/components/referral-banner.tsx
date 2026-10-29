import { SIGNUP_URL } from "@/lib/marketing-attribution";
import {
  REFERRAL_TRIAL_DAYS,
  REFERRAL_WELCOME_MONTHS,
  REFERRAL_WELCOME_PERCENT,
  shortClinicName,
} from "@/lib/referral-rules";

export function ReferralBanner({ clinicName, code }: { clinicName: string; code: string }) {
  const href = `${SIGNUP_URL}?ref=${encodeURIComponent(code)}`;
  return (
    <aside className="bg-mint/25 border-b border-sage/20 pt-24 pb-4">
      <div className="mx-auto flex max-w-[1100px] flex-col items-center gap-3 px-6 text-center text-forest sm:flex-row sm:justify-between sm:text-left">
        <p className="text-[15px]">
          <strong>{shortClinicName(clinicName)}</strong> indicou o FloraClin para você:{" "}
          {REFERRAL_TRIAL_DAYS} dias grátis + {REFERRAL_WELCOME_PERCENT}% de desconto nos{" "}
          {REFERRAL_WELCOME_MONTHS} primeiros meses.
        </p>
        <a
          href={href}
          className="shrink-0 rounded-full bg-sage px-5 py-2 text-sm font-medium text-cream hover:bg-forest"
        >
          Começar teste grátis
        </a>
      </div>
    </aside>
  );
}

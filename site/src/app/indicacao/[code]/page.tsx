import type { Metadata } from "next";
import { HomeSections } from "@/components/home-sections";
import { ReferralBanner } from "@/components/referral-banner";
import { isReferralSiteEnabled, lookupReferralCode } from "@/lib/referral-lookup";
import { normalizeReferralCode } from "@/lib/referral-rules";

export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default async function ReferralLandingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const normalized = normalizeReferralCode(code);
  if (normalized && isReferralSiteEnabled()) {
    const result = await lookupReferralCode(normalized);
    if (result.active) {
      return <HomeSections banner={<ReferralBanner clinicName={result.clinicName} code={normalized} />} />;
    }
  }
  return <HomeSections />;
}

import type { ReactNode } from "react";
import { Navigation } from "@/components/navigation";
import { Hero } from "@/components/hero";
import { Problem } from "@/components/problem";
import { HowItWorks } from "@/components/how-it-works";
import { FeatureShowcase } from "@/components/feature-showcase";
import { Testimonial } from "@/components/testimonial";
import { Pricing } from "@/components/pricing";
import { CtaBanner } from "@/components/cta-banner";
import { Faq } from "@/components/faq";
import { Contact } from "@/components/contact";
import { Footer } from "@/components/footer";

export function HomeSections({ banner }: { banner?: ReactNode }) {
  return (
    <>
      <Navigation />
      {banner}
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <FeatureShowcase />
        <Testimonial />
        <Pricing />
        <CtaBanner />
        <Faq />
        <Contact />
      </main>
      <Footer />
    </>
  );
}

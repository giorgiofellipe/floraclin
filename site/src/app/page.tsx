import { Navigation } from "@/components/navigation";
import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { FeatureShowcase } from "@/components/feature-showcase";
import { Testimonial } from "@/components/testimonial";
import { Pricing } from "@/components/pricing";
import { CtaBanner } from "@/components/cta-banner";
import { Faq } from "@/components/faq";
import { Footer } from "@/components/footer";

export default function Home() {
  return (
    <>
      <Navigation />
      <main>
        <Hero />
        <HowItWorks />
        <FeatureShowcase />
        <Testimonial />
        <Pricing />
        <CtaBanner />
        <Faq />
      </main>
      <Footer />
    </>
  );
}

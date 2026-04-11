import { Navigation } from "@/components/navigation";
import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { Features } from "@/components/features";
import { Testimonial } from "@/components/testimonial";
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
        <Features />
        <Testimonial />
        <CtaBanner />
        <Faq />
      </main>
      <Footer />
    </>
  );
}

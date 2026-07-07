import { Button } from "~/components/ui/button";

export function HeroBandMarketing() {
  return (
    <section className="bg-canvas py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h1 className="text-[80px] font-semibold text-ink leading-[1.10] -tracking-[2px] mb-6">
          MiniMax Music 2.6
        </h1>
        <p className="text-[18px] font-medium text-steel leading-[1.50] mb-8">
          Experience the future of AI-powered music generation
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button size="lg" className="rounded-full">
            Get Started
          </Button>
          <Button variant="outline" size="lg" className="rounded-full">
            Learn More
          </Button>
        </div>
      </div>
    </section>
  );
}

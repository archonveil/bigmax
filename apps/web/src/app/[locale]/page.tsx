import { isLocale } from "@bigmax/shared-types";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";

import { BrandsStrip } from "@/components/home/brands-strip";
import { CategoriesGrid } from "@/components/home/categories-grid";
import { FeaturedProducts } from "@/components/home/featured-products";
import { HeroSection } from "@/components/home/hero-section";

interface HomePageProps {
  params: { locale: string };
}

// P1-12: каждая секция-RSC оборачивается в Suspense — hero рендерится сразу,
// остальные стримятся как только их await'ы резолвятся. Раньше слайс самой
// медленной секции блокировал весь home-render. Skeleton'ы подобраны под
// финальный layout чтобы избежать CLS.
export default async function HomePage({ params }: HomePageProps): Promise<JSX.Element> {
  if (!isLocale(params.locale)) notFound();
  setRequestLocale(params.locale);

  return (
    <>
      <HeroSection />
      <Suspense fallback={<CategoriesGridSkeleton />}>
        <CategoriesGrid locale={params.locale} />
      </Suspense>
      <Suspense fallback={<FeaturedProductsSkeleton />}>
        <FeaturedProducts locale={params.locale} />
      </Suspense>
      <Suspense fallback={<BrandsStripSkeleton />}>
        <BrandsStrip />
      </Suspense>
    </>
  );
}

function CategoriesGridSkeleton(): JSX.Element {
  return (
    <section className="container py-12" aria-hidden>
      <div className="mx-auto mb-8 h-7 w-48 animate-pulse rounded bg-muted" />
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="h-32 animate-pulse rounded-lg border bg-muted/40" />
        ))}
      </ul>
    </section>
  );
}

function FeaturedProductsSkeleton(): JSX.Element {
  return (
    <section className="container py-12" aria-hidden>
      <div className="mx-auto mb-8 h-7 w-56 animate-pulse rounded bg-muted" />
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="aspect-[3/4] animate-pulse rounded-lg border bg-muted/40" />
        ))}
      </ul>
    </section>
  );
}

function BrandsStripSkeleton(): JSX.Element {
  return (
    <section className="container py-12" aria-hidden>
      <div className="mx-auto mb-8 h-7 w-40 animate-pulse rounded bg-muted" />
      <ul className="flex flex-wrap justify-center gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="h-9 w-24 animate-pulse rounded-full bg-muted/40" />
        ))}
      </ul>
    </section>
  );
}

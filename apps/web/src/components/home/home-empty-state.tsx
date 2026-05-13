import { Link } from "@bigmax/i18n/navigation";
import { Package } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";

export async function HomeEmptyState(): Promise<JSX.Element> {
  const t = await getTranslations("home");

  return (
    <section className="container flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
      {/* Icon */}
      <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-secondary">
        <Package className="h-12 w-12 text-secondary-foreground/60" aria-hidden />
      </div>

      {/* Animated dots decoration */}
      <div className="mb-6 flex gap-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 animate-bounce rounded-full bg-primary/40"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>

      <h2 className="mb-3 text-3xl font-bold tracking-tight">{t("emptyTitle")}</h2>
      <p className="mb-10 max-w-md text-base leading-relaxed text-muted-foreground">
        {t("emptySubtitle")}
      </p>

      <Button asChild size="lg" variant="outline" className="rounded-full px-8">
        <Link href="/contacts" as="/contacts">
          {t("emptyContactUs")}
        </Link>
      </Button>
    </section>
  );
}

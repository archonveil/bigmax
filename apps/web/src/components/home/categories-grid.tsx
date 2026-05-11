import { Link } from "@bigmax/i18n/navigation";
import { localized, type Locale } from "@bigmax/shared-types";
import {
  Armchair,
  Baby,
  Droplets,
  Milk,
  Package,
  Shirt,
  Sparkles,
  ToyBrick,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getActiveCategories } from "@/server/catalog";

interface CategoriesGridProps {
  locale: Locale;
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  clothing: Shirt,
  toys: ToyBrick,
  food: Milk,
  diapers: Baby,
  hygiene: Droplets,
  feeding: UtensilsCrossed,
  strollers: Baby,
  furniture: Armchair,
  accessories: Sparkles,
};

export async function CategoriesGrid({ locale }: CategoriesGridProps): Promise<JSX.Element> {
  const categories = await getActiveCategories();
  const t = await getTranslations("home");

  return (
    <section className="container py-12">
      <h2 className="mb-8 text-center text-2xl font-semibold">{t("categoriesTitle")}</h2>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {categories.map((c) => {
          const Icon = CATEGORY_ICONS[c.slug] ?? Package;
          return (
            <li key={c.id}>
              <Link
                href={`/catalog/${c.slug}` as never}
                className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border bg-card p-5 text-center transition hover:border-primary/40 hover:shadow-md"
              >
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <Icon className="h-6 w-6" aria-hidden />
                </span>
                <span className="text-sm font-medium">{localized(c, "name", locale)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

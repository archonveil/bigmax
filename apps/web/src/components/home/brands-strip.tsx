import { Link } from "@bigmax/i18n/navigation";
import { getTranslations } from "next-intl/server";

import { getActiveBrands } from "@/server/catalog";

export async function BrandsStrip(): Promise<JSX.Element> {
  const brands = await getActiveBrands();
  const t = await getTranslations("home");

  return (
    <section className="container py-12">
      <h2 className="mb-8 text-center text-2xl font-semibold">{t("brandsTitle")}</h2>
      <ul className="flex flex-wrap justify-center gap-3">
        {brands.map((b) => (
          <li key={b.id}>
            <Link
              href={`/brands/${b.slug}` as never}
              className="inline-flex items-center rounded-full border bg-card px-5 py-2 text-sm font-medium transition hover:border-primary/40 hover:text-primary"
            >
              {b.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

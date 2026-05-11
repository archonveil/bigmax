import { MessageSquare } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * Пустое состояние для отзывов. Полноценная форма публикации с фото и
 * модерацией придёт в P7-T3; сейчас юзер видит что секция есть, но
 * данных нет.
 */
export async function ReviewsSection(): Promise<JSX.Element> {
  const t = await getTranslations("product.reviews");

  return (
    <section className="mt-10">
      <h2 className="mb-4 text-xl font-semibold">{t("title")}</h2>
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
        <MessageSquare className="h-10 w-10 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">{t("empty")}</p>
        <p className="text-xs text-muted-foreground">{t("comingSoon")}</p>
      </div>
    </section>
  );
}

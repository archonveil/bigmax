"use client";

/**
 * Тяжёлая часть QuickView: shadcn Dialog + Radix portal + VariantPicker +
 * AttributesTable + ProductImage. Лениво подгружается из `quick-view.tsx`
 * через `next/dynamic`, чтобы catalog/home pages не платили ~30–60 KB JS
 * на каждой product-card до первого клика по «Quick view» (P2-28).
 */

import { Link } from "@bigmax/i18n/navigation";
import { localized, type Locale } from "@bigmax/shared-types";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { extractColorOptions, type CategoryAttributeConfig } from "@/catalog/category-attributes";
import { AttributesTable } from "@/components/product/attributes-table";
import { VariantPicker } from "@/components/product/variant-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProductImage } from "@/components/ui/product-image";
import { cn } from "@/lib/utils";
import type { ProductDetail } from "@/server/catalog";

export interface QuickViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  locale: Locale;
}

export default function QuickViewDialog({
  open,
  onOpenChange,
  slug,
  locale,
}: QuickViewDialogProps): JSX.Element {
  const t = useTranslations("quickView");
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [attributeConfigs, setAttributeConfigs] = useState<readonly CategoryAttributeConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(slug)}`);
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = (await res.json()) as {
        product: ProductDetail;
        attributeConfigs: CategoryAttributeConfig[];
      };
      setProduct(data.product);
      setAttributeConfigs(data.attributeConfigs ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  // Загружаем по первому открытию, без pre-fetch'а при рендере карточки —
  // иначе на странице каталога было бы ×24 лишних запроса.
  useEffect(() => {
    if (open && !product && !loading && !error) {
      void load();
    }
  }, [open, product, loading, error, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // Адаптивная ширина: на mobile — почти полный экран по ширине
          // с 16px полями; на больших — до 4xl.
          "w-[calc(100vw-2rem)] max-w-4xl",
          // Главное: DialogContent как flex-column с ограниченной высотой,
          // чтобы inner-body мог иметь `flex-1 min-h-0 overflow-hidden`
          // и правая колонка внутри него скроллилась независимо.
          "flex max-h-[90vh] flex-col gap-0 p-0",
        )}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {product ? localized(product, "name", locale) : t("loading")}
          </DialogDescription>
        </DialogHeader>

        {loading && !product ? (
          <div className="flex min-h-[16rem] flex-1 items-center justify-center p-6">
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          </div>
        ) : error ? (
          <div className="flex min-h-[16rem] flex-1 items-center justify-center p-6">
            <p className="text-sm text-destructive">{t("error")}</p>
          </div>
        ) : product ? (
          <QuickViewBody product={product} locale={locale} attributeConfigs={attributeConfigs} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface QuickViewBodyProps {
  product: ProductDetail;
  locale: Locale;
  attributeConfigs: readonly CategoryAttributeConfig[];
}

function QuickViewBody({ product, locale, attributeConfigs }: QuickViewBodyProps): JSX.Element {
  const t = useTranslations("quickView");
  const name = localized(product, "name", locale);
  const description = localized(product, "description", locale);
  const primaryImage = product.images[0]?.url ?? null;

  return (
    <div
      className={cn(
        "grid min-h-0 flex-1 gap-4 p-4",
        "overflow-y-auto",
        "sm:grid-cols-2 sm:gap-6 sm:p-6 sm:overflow-hidden",
        "sm:aspect-[2/1] sm:max-h-full",
      )}
    >
      <div className="relative mx-auto aspect-square w-full max-w-[20rem] overflow-hidden rounded-md bg-muted sm:max-w-none sm:self-start">
        <ProductImage
          src={primaryImage}
          alt={name}
          fill
          sizes="(min-width: 640px) 360px, 90vw"
          className="object-cover"
        />
      </div>

      <div className="flex min-w-0 min-h-0 flex-col gap-3 sm:gap-4 sm:overflow-y-auto sm:pr-2">
        {product.brand ? (
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {product.brand.name}
          </p>
        ) : null}
        <h2 className="text-xl font-bold leading-tight sm:text-2xl">{name}</h2>

        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}

        <VariantPicker
          product={{
            id: product.id,
            slug: product.slug,
            nameRu: product.nameRu,
            nameUz: product.nameUz,
            nameEn: product.nameEn,
            brandName: product.brand?.name ?? null,
            imageUrl: primaryImage,
          }}
          variants={product.variants}
          locale={locale}
          colorOptions={extractColorOptions(attributeConfigs)}
        />

        <AttributesTable
          product={product}
          locale={locale}
          attributeConfigs={attributeConfigs}
          variant="compact"
        />

        <Button asChild variant="outline" size="sm" className="mt-2 w-full sm:w-auto">
          <Link href={`/product/${product.slug}` as never}>
            {t("viewFull")}
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}

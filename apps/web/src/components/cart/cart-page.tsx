"use client";

import { Link } from "@bigmax/i18n/navigation";
import { formatCurrencyUzs, localized, type Locale } from "@bigmax/shared-types";
import { ArrowRight, Loader2, Minus, Plus, ShoppingBag, Tag, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  computeDeliveryDiscountCents,
  computeDiscountCents,
  isPromoApplicable,
  type AppliedPromo,
} from "@/cart/promo";
import {
  selectItems,
  selectSubtotalCents,
  selectTotalItems,
  useCart,
  useCartHydrated,
  type CartItem,
} from "@/cart/store";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProductImage } from "@/components/ui/product-image";
import { cn } from "@/lib/utils";

/** API response shape — держим рядом с консьюмером. */
type PromoValidateResponse =
  | { ok: true; promo: AppliedPromo }
  | { ok: false; error: "invalid" | "expired" | "usageLimitReached" };

/**
 * Страница /cart. До `hydrated=true` рендерим скелетон, иначе получаем
 * SSR=0 items → hydrate=N items мигание. После hydrate показываем реальный
 * state из `useCart`.
 */
export function CartPageClient(): JSX.Element {
  const t = useTranslations("cart.page");
  const tCart = useTranslations("cart");
  const tCommon = useTranslations("common");
  const locale = useLocale() as Locale;
  const hydrated = useCartHydrated();
  const items = useCart(selectItems);
  const totalItems = useCart(selectTotalItems);
  const subtotalCents = useCart(selectSubtotalCents);
  const appliedPromo = useCart((s) => s.appliedPromo);
  const setPromo = useCart((s) => s.setPromo);
  const clearPromo = useCart((s) => s.clearPromo);
  const clearCart = useCart((s) => s.clear);

  // Auto-cleanup: при удалении позиций subtotal может упасть ниже minOrder'а —
  // снимаем применённый промо, чтобы не показывать «фантомную» скидку.
  useEffect(() => {
    if (!hydrated || !appliedPromo) return;
    const check = isPromoApplicable(appliedPromo, subtotalCents);
    if (!check.ok) clearPromo();
  }, [hydrated, appliedPromo, subtotalCents, clearPromo]);

  // Re-validate applied promo на mount. Между apply и visit сервер мог
  // дезактивировать промо (admin отключил, истёк endsAt, исчерпан limit).
  // Один fetch per page visit → UX не ломается, snapshot в localStorage
  // чистится, юзер видит ошибку и вводит новый код.
  const revalidatedCodeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated || !appliedPromo) return;
    if (revalidatedCodeRef.current === appliedPromo.code) return;
    revalidatedCodeRef.current = appliedPromo.code;
    const controller = new AbortController();
    fetch(`/api/promo/validate?code=${encodeURIComponent(appliedPromo.code)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: PromoValidateResponse) => {
        if (data.ok) return;
        clearPromo();
        const map = {
          invalid: t("promoInvalid"),
          expired: t("promoExpired"),
          usageLimitReached: t("promoUsageLimit"),
        } as const;
        toast.error(map[data.error]);
      })
      .catch(() => {
        // Сетевая ошибка — не трогаем применённый промо.
      });
    return () => controller.abort();
  }, [hydrated, appliedPromo, clearPromo, t]);

  if (!hydrated) {
    return (
      <section className="container py-10">
        <h1 className="mb-6 text-3xl font-bold">{t("title")}</h1>
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="container py-10">
        <h1 className="mb-6 text-3xl font-bold">{t("title")}</h1>
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center">
          <ShoppingBag className="h-12 w-12 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <p className="text-lg font-medium">{t("emptyTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
          </div>
          <Button asChild>
            <Link href="/catalog">{t("continueShopping")}</Link>
          </Button>
        </div>
      </section>
    );
  }

  const discountCents = appliedPromo ? computeDiscountCents(appliedPromo, subtotalCents) : 0;
  const deliveryFreeHint = appliedPromo && computeDeliveryDiscountCents(appliedPromo, 1) > 0;
  const totalCents = subtotalCents - discountCents;

  return (
    <section className="container grid gap-8 py-10 lg:grid-cols-[1fr_360px]">
      <div>
        <h1 className="mb-6 text-3xl font-bold">{t("title")}</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          {tCart("itemsCount", { count: totalItems })}
        </p>

        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <CartPageLine key={item.variantId} item={item} locale={locale} />
          ))}
        </ul>
      </div>

      {/* Summary */}
      <aside className="h-fit space-y-4 rounded-lg border bg-card p-5 lg:sticky lg:top-24">
        <PromoSection
          appliedPromo={appliedPromo}
          subtotalCents={subtotalCents}
          onApplied={setPromo}
          onCleared={clearPromo}
        />

        <dl className="space-y-2 border-t pt-4 text-sm">
          <Row label={t("subtotal")} value={formatCurrencyUzs(subtotalCents, locale)} />
          {discountCents > 0 ? (
            <Row
              label={t("discount")}
              // Negative cents + default signDisplay=auto → Intl ставит корректный
              // minus (U+2212 для ru) сам; конкатенации вручную больше нет.
              value={formatCurrencyUzs(-discountCents, locale)}
              valueClassName="text-primary"
            />
          ) : null}
          <Row
            label={t("delivery")}
            value={t("deliveryCalculated")}
            valueClassName="text-muted-foreground"
          />
          {deliveryFreeHint ? (
            <p className="text-xs text-primary">{t("promoDeliveryHint")}</p>
          ) : null}
        </dl>

        <dl className="flex items-baseline justify-between border-t pt-4 text-base font-semibold">
          <dt>{t("total")}</dt>
          <dd className="text-lg">{formatCurrencyUzs(totalCents, locale)}</dd>
        </dl>

        <Button asChild size="lg" className="w-full">
          <Link href="/checkout">
            {t("checkout")}
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
          </Link>
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden />
              {t("clearCart")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("clearCart")}</AlertDialogTitle>
              <AlertDialogDescription>{t("clearCartConfirm")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => clearCart()}>{t("clearCart")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </aside>
    </section>
  );
}

interface RowProps {
  label: string;
  value: string;
  valueClassName?: string;
}

function Row({ label, value, valueClassName }: RowProps): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-right", valueClassName)}>{value}</dd>
    </div>
  );
}

interface PromoSectionProps {
  appliedPromo: AppliedPromo | null;
  subtotalCents: number;
  onApplied: (promo: AppliedPromo) => void;
  onCleared: () => void;
}

function PromoSection({
  appliedPromo,
  subtotalCents,
  onApplied,
  onCleared,
}: PromoSectionProps): JSX.Element {
  const t = useTranslations("cart.page");
  const locale = useLocale() as Locale;
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);

  async function apply(): Promise<void> {
    const trimmed = code.trim();
    if (trimmed.length === 0) return;
    setPending(true);
    try {
      const res = await fetch(`/api/promo/validate?code=${encodeURIComponent(trimmed)}`);
      const data = (await res.json()) as PromoValidateResponse;
      if (!data.ok) {
        const map = {
          invalid: t("promoInvalid"),
          expired: t("promoExpired"),
          usageLimitReached: t("promoUsageLimit"),
        } as const;
        toast.error(map[data.error]);
        return;
      }
      const check = isPromoApplicable(data.promo, subtotalCents);
      if (!check.ok) {
        toast.error(
          t("promoMinOrder", { amount: formatCurrencyUzs(data.promo.minOrderCents, locale) }),
        );
        return;
      }
      onApplied(data.promo);
      toast.success(t("promoApplied", { code: data.promo.code }));
      setCode("");
    } catch {
      toast.error(t("promoInvalid"));
    } finally {
      setPending(false);
    }
  }

  if (appliedPromo) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border bg-primary/5 p-3 text-sm">
        <div className="flex min-w-0 items-center gap-2">
          <Tag className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden />
          <span className="truncate font-medium">
            {t("promoApplied", { code: appliedPromo.code })}
          </span>
        </div>
        <button
          type="button"
          onClick={onCleared}
          aria-label={t("promoRemove")}
          className="flex-shrink-0 text-muted-foreground transition hover:text-destructive"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void apply();
      }}
      className="space-y-2"
    >
      <Label htmlFor="promo-code">{t("promoLabel")}</Label>
      <div className="flex gap-2">
        <Input
          id="promo-code"
          type="text"
          autoComplete="off"
          placeholder={t("promoPlaceholder")}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={pending}
          className="uppercase"
        />
        <Button type="submit" size="default" disabled={pending || code.trim().length === 0}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("promoApply")}
        </Button>
      </div>
    </form>
  );
}

interface CartPageLineProps {
  item: CartItem;
  locale: Locale;
}

function CartPageLine({ item, locale }: CartPageLineProps): JSX.Element {
  const t = useTranslations("cart");
  const inc = useCart((s) => s.inc);
  const dec = useCart((s) => s.dec);
  const remove = useCart((s) => s.remove);

  const lineTotal = item.priceCents * item.quantity;
  const variantLabel = [item.color, item.size].filter(Boolean).join(" · ");

  return (
    <li className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-center">
      <Link
        href={`/product/${item.productSlug}` as never}
        className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded bg-muted"
      >
        <ProductImage src={item.imageUrl} alt="" fill sizes="80px" className="object-cover" />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link
          href={`/product/${item.productSlug}` as never}
          className="line-clamp-2 text-sm font-medium hover:text-primary"
        >
          {localized(item, "name", locale)}
        </Link>
        {item.brandName ? (
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.brandName}</p>
        ) : null}
        {variantLabel ? <p className="text-xs text-muted-foreground">{variantLabel}</p> : null}
      </div>

      <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
        <div className="inline-flex items-center rounded-md border">
          <button
            type="button"
            onClick={() => dec(item.variantId)}
            aria-label={t("qtyDecrease")}
            className="flex h-9 w-9 items-center justify-center hover:bg-accent"
          >
            <Minus className="h-4 w-4" aria-hidden />
          </button>
          <span className="min-w-[2.5rem] px-1 text-center text-sm tabular-nums">
            {item.quantity}
          </span>
          <button
            type="button"
            onClick={() => inc(item.variantId)}
            aria-label={t("qtyIncrease")}
            disabled={item.quantity >= 99}
            className="flex h-9 w-9 items-center justify-center hover:bg-accent disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-primary">
            {formatCurrencyUzs(lineTotal, locale)}
          </span>
          <button
            type="button"
            onClick={() => remove(item.variantId)}
            aria-label={t("remove")}
            className="text-muted-foreground transition hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </li>
  );
}

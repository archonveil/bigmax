"use client";

import { Link } from "@bigmax/i18n/navigation";
import { formatCurrencyUzs, type Locale, type OrderStatusResponse } from "@bigmax/shared-types";
import { CheckCircle2, Loader2, RotateCw, ShoppingBag, XCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 60_000;

/**
 * `success` — после `URL_RETURN_OK` от Uniteller. Стартует с pending до
 * webhook'а; ожидает captured. Если webhook не пришёл за 60с — показываем
 * «обрабатывается, проверим позже».
 *
 * `failure` — после `URL_RETURN_NO`. Платёж в `failed`/`cancelled`. Polling
 * не нужен (terminal state), но всё равно делаем 1 fetch для отображения
 * номера заказа и фактического статуса.
 *
 * `return` — нейтральный. Юзер вернулся через `URL_RETURN` (например, кликнул
 * «Назад» на форме Uniteller). Показываем текущий статус как есть.
 */
export type OrderStatusVariant = "success" | "failure" | "return";

interface OrderStatusViewProps {
  orderId: string;
  variant: OrderStatusVariant;
  initial: OrderStatusResponse;
}

const TERMINAL_PAYMENT_STATUSES = new Set([
  "captured",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
]);

export function OrderStatusView({ orderId, variant, initial }: OrderStatusViewProps): JSX.Element {
  const t = useTranslations("orders.status");
  const locale = useLocale() as Locale;
  const [data, setData] = useState<OrderStatusResponse>(initial);
  // Polling нужен только для Uniteller-flow на success-странице — мы ждём
  // когда придёт webhook и перевернёт `Payment.status` в captured. COD —
  // деньги при доставке, статус остаётся pending до admin-flow (P6-T5),
  // polling бессмысленен.
  const isCod = initial.paymentProvider === "cod";
  const [pollState, setPollState] = useState<"polling" | "idle" | "timed_out">(
    variant === "success" && !isCod && !TERMINAL_PAYMENT_STATUSES.has(initial.paymentStatus)
      ? "polling"
      : "idle",
  );
  const startedAtRef = useRef<number>(Date.now());
  const inFlightRef = useRef(false);

  const fetchStatus = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as OrderStatusResponse;
      setData(json);
      if (TERMINAL_PAYMENT_STATUSES.has(json.paymentStatus)) {
        setPollState("idle");
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [orderId]);

  useEffect(() => {
    if (pollState !== "polling") return;
    const interval = setInterval(() => {
      void fetchStatus();
      if (Date.now() - startedAtRef.current >= POLL_TIMEOUT_MS) {
        setPollState("timed_out");
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [pollState, fetchStatus]);

  const isPaid = data.paymentStatus === "captured";
  const isFailed = data.paymentStatus === "failed" || data.paymentStatus === "cancelled";
  // COD-заказ на success-странице по UX-смыслу = «успешно оформлен»: показываем
  // continueShopping CTA и default-вариант кнопки «Мои заказы».
  const isAccepted = isPaid || (isCod && variant === "success");

  return (
    <section className="container space-y-6 py-10">
      <header className="space-y-2">
        <StatusBadge variant={variant} isPaid={isAccepted} isFailed={isFailed} />
        <h1 className="text-3xl font-bold">{t(`${variant}.title`)}</h1>
        <p className="text-sm text-muted-foreground">
          {t("orderNumber", { number: data.number })} · {formatCurrencyUzs(data.totalCents, locale)}
        </p>
      </header>

      {variant === "success" && isCod ? (
        <Alert variant="warning">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          <AlertTitle>{t("cod.title")}</AlertTitle>
          <AlertDescription>{t("cod.body")}</AlertDescription>
        </Alert>
      ) : null}

      {variant === "success" && !isCod && pollState === "polling" ? (
        <Alert variant="info">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <AlertTitle>{t("polling.title")}</AlertTitle>
          <AlertDescription>{t("polling.body")}</AlertDescription>
        </Alert>
      ) : null}

      {variant === "success" && !isCod && isPaid ? (
        <Alert variant="warning">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          <AlertTitle>{t("paid.title")}</AlertTitle>
          <AlertDescription>{t("paid.body")}</AlertDescription>
        </Alert>
      ) : null}

      {variant === "success" && !isCod && pollState === "timed_out" && !isPaid ? (
        <Alert variant="info">
          <Loader2 className="h-4 w-4" aria-hidden />
          <AlertTitle>{t("timeout.title")}</AlertTitle>
          <AlertDescription>
            <p className="mb-3">{t("timeout.body")}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void fetchStatus()}>
              <RotateCw className="mr-2 h-4 w-4" aria-hidden />
              {t("timeout.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {(variant === "failure" || isFailed) && !isPaid ? (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" aria-hidden />
          <AlertTitle>{t("failed.title")}</AlertTitle>
          <AlertDescription>{t("failed.body")}</AlertDescription>
        </Alert>
      ) : null}

      {variant === "return" && !isPaid && !isFailed ? (
        <Alert variant="info">
          <Loader2 className="h-4 w-4" aria-hidden />
          <AlertTitle>{t("return.title")}</AlertTitle>
          <AlertDescription>{t("return.body")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-3 pt-2">
        <Button asChild variant={isAccepted ? "default" : "outline"}>
          <Link href="/account/orders">
            <ShoppingBag className="mr-2 h-4 w-4" aria-hidden />
            {t("actions.myOrders")}
          </Link>
        </Button>
        {!isAccepted ? (
          <Button asChild variant="ghost">
            <Link href="/cart">{t("actions.backToCart")}</Link>
          </Button>
        ) : (
          <Button asChild variant="ghost">
            <Link href="/catalog">{t("actions.continueShopping")}</Link>
          </Button>
        )}
      </div>
    </section>
  );
}

interface StatusBadgeProps {
  variant: OrderStatusVariant;
  isPaid: boolean;
  isFailed: boolean;
}

function StatusBadge({ variant, isPaid, isFailed }: StatusBadgeProps): JSX.Element {
  const tone =
    isPaid || (variant === "success" && !isFailed)
      ? "bg-primary/10 text-primary"
      : isFailed || variant === "failure"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground";
  const label = isPaid
    ? "✓"
    : isFailed
      ? "✕"
      : variant === "success"
        ? "…"
        : variant === "failure"
          ? "✕"
          : "?";
  return (
    <span
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full text-2xl font-bold ${tone}`}
      aria-hidden
    >
      {label}
    </span>
  );
}

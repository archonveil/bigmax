"use client";

/**
 * `<RecheckButton>` (P6-T6) — кнопка ручной pull-проверки статуса
 * Uniteller. Pure-button: POST → toast → `router.refresh()`. На COD
 * disabled (recheck не имеет смысла без провайдера) — показываем
 * кнопку с tooltip-объяснением, но disabled.
 */

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface Props {
  paymentId: string;
  provider: string;
}

export function RecheckButton({ paymentId, provider }: Props): JSX.Element {
  const t = useTranslations("admin.payments.recheck");
  const tErr = useTranslations("admin.payments.errors");
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const onClick = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/payments/${paymentId}/recheck`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        ok: boolean;
        reason?: string;
        changed?: boolean;
        status?: string;
        providerStatus?: string;
      };
      if (res.ok && body.ok) {
        if (body.changed) {
          toast.success(t("successChanged", { status: body.status ?? "—" }));
        } else {
          toast.info(t("successUnchanged", { status: body.status ?? "—" }));
        }
        router.refresh();
        return;
      }
      const key = body.reason ?? "generic";
      toast.error(translateErr(key, tErr));
    } catch {
      toast.error(tErr("generic"));
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = submitting || provider === "cod";

  return (
    <Button
      variant="outline"
      onClick={() => void onClick()}
      disabled={disabled}
      title={provider === "cod" ? t("disabledCod") : undefined}
      data-testid="payment-recheck-button"
    >
      <RefreshCw className={`mr-2 h-4 w-4 ${submitting ? "animate-spin" : ""}`} aria-hidden />
      {submitting ? t("submitting") : t("trigger")}
    </Button>
  );
}

function translateErr(
  key: string,
  t: ReturnType<typeof useTranslations<"admin.payments.errors">>,
): string {
  const known = [
    "cod_recheck_unsupported",
    "no_uniteller_idp",
    "payment_not_found",
    "provider_error",
    "provider_misconfigured",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(key as (typeof known)[number]);
  }
  return t("generic");
}

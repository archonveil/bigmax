"use client";

/**
 * P7-T2 sub-task I · кнопка «Очистить кэш» в шапке /admin/features/[key].
 *
 * Когда полезна:
 *  - Admin поменял `features` row через прямой SQL UPDATE (bypassing UI) и
 *    хочет мгновенно подхватить новое значение без 60s TTL.
 *  - Подозрения на stale-cache при отладке.
 *
 * PATCH-flow в feature-form.tsx уже сам вызывает invalidate — кнопка
 * нужна только для out-of-band updates.
 */

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function InvalidateCacheButton({ featureKey }: { featureKey: string }): JSX.Element {
  const t = useTranslations("admin.features.form");
  const tErr = useTranslations("admin.features.errors");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/features/${encodeURIComponent(featureKey)}/invalidate`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success(t("invalidated"));
        router.refresh();
        return;
      }
      toast.error(tErr("generic"));
    } catch {
      toast.error(tErr("generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() => void onClick()}
      data-testid="feature-invalidate-button"
    >
      <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
      {busy ? t("invalidating") : t("invalidate")}
    </Button>
  );
}

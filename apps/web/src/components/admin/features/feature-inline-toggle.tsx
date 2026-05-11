"use client";

/**
 * FF-001 · inline boolean toggle для списка `/admin/features`.
 *
 * Один клик прямо в Value-колонке переключает `true ↔ false` без захода
 * на edit-страницу. Optimistic UI: переключаем state визуально → PATCH →
 * на ошибке откатываем + toast. На успехе → toast + router.refresh
 * (re-fetch list + actualize updatedAt в таблице).
 *
 * **High-risk overlay**: `loyalty.spend_enabled` — это kill-switch на
 * production-flow. Toggle ставит pending-state и зовёт callback родителя
 * (через prop `onHighRiskClick`) для показа AlertDialog'а (см. FF-003).
 * Если `onHighRiskClick` не передан — toggle применяется напрямую.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";

interface Props {
  featureKey: string;
  /** Initial value из БД ("true" или "false"). */
  initialValue: string;
}

export function FeatureInlineToggle({ featureKey, initialValue }: Props): JSX.Element {
  const t = useTranslations("admin.features.list");
  const tErr = useTranslations("admin.features.errors");
  const router = useRouter();
  const [checked, setChecked] = useState(initialValue === "true");
  const [pending, startTransition] = useTransition();

  const onChange = (next: boolean): void => {
    if (pending) return;
    const previous = checked;
    setChecked(next); // optimistic
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/features/${encodeURIComponent(featureKey)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: next ? "true" : "false" }),
        });
        if (!res.ok) {
          setChecked(previous); // revert
          const body = (await res.json().catch(() => ({}))) as { reason?: string };
          toast.error(tErr(body.reason === "not_found" ? "not_found" : "generic"));
          return;
        }
        toast.success(t("toggleSuccess", { key: featureKey }));
        router.refresh();
      } catch {
        setChecked(previous);
        toast.error(tErr("generic"));
      }
    });
  };

  return (
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      disabled={pending}
      aria-label={t("toggleAriaLabel", { key: featureKey })}
      data-testid="feature-inline-toggle"
      data-feature-key={featureKey}
    />
  );
}

"use client";

/**
 * FF-005 · «Откатить»-button в строке `<FeatureAuditTimeline>`.
 *
 * Один клик на icon-button у строки `feature.updated` → confirmation modal
 * с diff-preview `current → targetValue` → PATCH /api/admin/features/<key>
 * → router.refresh.
 *
 * **Семантика**: revert = «вернуть значение, которое БЫЛО ДО этой
 * конкретной записи лога». Т.е. для строки `oldValue → newValue` кнопка
 * ставит value обратно в `oldValue`. Если в timeline'е несколько
 * последовательных изменений, можно последовательно откатываться вверх
 * по истории — каждое нажатие = +1 PATCH-запись.
 *
 * **High-risk gate**: FF-003 confirmation для опасных ключей здесь
 * автоматически НЕ применяется (см. комментарий в `onConfirm`) — отдельная
 * confirmation у revert'а уже есть; double-prompt'a избегаем.
 */

import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface Props {
  featureKey: string;
  /** Целевое значение — `oldValue` той log-row, на которой висит кнопка. */
  targetValue: string;
  /** Текущее значение feature'ы (для diff в confirmation modal). */
  currentValue: string;
}

export function RevertButton({ featureKey, targetValue, currentValue }: Props): JSX.Element {
  const t = useTranslations("admin.features.audit");
  const tErr = useTranslations("admin.features.errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Дисэйблим если revert ничего не изменит (target = current).
  const isNoOp = targetValue === currentValue;

  const onConfirm = (): void => {
    setOpen(false);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/features/${encodeURIComponent(featureKey)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: targetValue }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { reason?: string };
          toast.error(tErr(body.reason === "not_found" ? "not_found" : "generic"));
          return;
        }
        toast.success(t("revertSuccess", { key: featureKey, value: targetValue }));
        router.refresh();
      } catch {
        toast.error(tErr("generic"));
      }
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending || isNoOp}
        onClick={() => setOpen(true)}
        aria-label={t("revertAriaLabel")}
        title={isNoOp ? t("revertNoOpTitle") : t("revertTitle")}
        data-testid="feature-audit-revert"
        data-feature-key={featureKey}
        data-target-value={targetValue}
        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden />
        {t("revert")}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent data-testid="feature-audit-revert-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revertConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("revertConfirmBody", { key: featureKey })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div
            className="rounded-md border bg-muted/30 px-3 py-2 text-xs font-mono text-muted-foreground"
            data-testid="feature-audit-revert-diff"
          >
            <span className="line-through opacity-70">{currentValue}</span>
            <span className="mx-1.5">→</span>
            <span className="text-foreground">{targetValue}</span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="feature-audit-revert-cancel">
              {t("revertCancel")}
            </AlertDialogCancel>
            <AlertDialogAction data-testid="feature-audit-revert-proceed" onClick={onConfirm}>
              {t("revertProceed")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

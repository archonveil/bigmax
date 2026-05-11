"use client";

/**
 * `<ResetPasswordDialog>` (P6-T8) — модалка генерации временного пароля
 * для клиента. После submit'а показывает plain-text пароль один раз
 * (admin копирует и диктует клиенту через защищённый канал; в БД
 * хранится только bcrypt-hash). Закрытие диалога стирает пароль из
 * памяти компонента — повторно его не показать (только новый reset).
 */

import { Copy, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface Props {
  userId: string;
  hasPassword: boolean;
}

interface ResetResponse {
  ok: boolean;
  reason?: string;
  temporaryPassword?: string;
}

export function ResetPasswordDialog({ userId, hasPassword }: Props): JSX.Element {
  const t = useTranslations("admin.customers.resetPassword");
  const tErr = useTranslations("admin.customers.errors");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean): void => {
    setOpen(next);
    if (!next) {
      // Очищаем state при закрытии — пароль больше не показать.
      setTempPassword(null);
      setReason("");
      setError(null);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/customers/${userId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as ResetResponse;
      if (res.ok && body.ok && body.temporaryPassword) {
        setTempPassword(body.temporaryPassword);
        return;
      }
      const key = body.reason ?? "generic";
      setError(translateErr(key, tErr));
    } catch {
      setError(tErr("generic"));
    } finally {
      setSubmitting(false);
    }
  };

  const onCopy = async (): Promise<void> => {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="customer-reset-password-trigger">
          <KeyRound className="mr-2 h-4 w-4" aria-hidden />
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        {tempPassword ? (
          <div className="space-y-3" data-testid="customer-reset-password-success">
            <p className="text-sm text-muted-foreground">{t("successHelp")}</p>
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
              <code
                className="flex-1 select-all font-mono text-lg"
                data-testid="customer-reset-password-temp"
              >
                {tempPassword}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onCopy()}
                data-testid="customer-reset-password-copy"
              >
                <Copy className="mr-1 h-4 w-4" aria-hidden />
                {t("copy")}
              </Button>
            </div>
            <p className="text-xs text-amber-700">{t("warning")}</p>
            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                {t("close")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            className="space-y-3"
            data-testid="customer-reset-password-form"
          >
            {hasPassword ? null : (
              <p
                className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800"
                data-testid="customer-reset-password-warning-otp"
              >
                {t("otpUserWarning")}
              </p>
            )}
            <div>
              <Label htmlFor="reset-reason">{t("reason")}</Label>
              <textarea
                id="reset-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
                required
                minLength={3}
                maxLength={500}
                placeholder={t("reasonPlaceholder")}
                className="min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
                data-testid="customer-reset-password-reason"
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive" data-testid="customer-reset-password-error">
                {error}
              </p>
            ) : null}
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={submitting}
                data-testid="customer-reset-password-submit"
              >
                {submitting ? t("submitting") : t("submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function translateErr(
  key: string,
  t: ReturnType<typeof useTranslations<"admin.customers.errors">>,
): string {
  const known = [
    "invalid_body",
    "user_not_found",
    "user_has_no_password",
    "reason_too_short",
    "reason_too_long",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(key as (typeof known)[number]);
  }
  return t("generic");
}

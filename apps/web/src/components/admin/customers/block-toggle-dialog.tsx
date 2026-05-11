"use client";

/**
 * `<BlockToggleDialog>` (P6-T8 follow-up — closes (a)). Кнопка для admin'а
 * заблокировать или разблокировать клиента с reason для аудита. Заблокированный
 * клиент не может пройти `signIn` через email/password или OTP — provider'ы
 * проверяют `User.isBlocked` в auth/config.ts.
 */

import { Ban, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
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
  isBlocked: boolean;
  isSelf: boolean;
}

export function BlockToggleDialog({ userId, isBlocked, isSelf }: Props): JSX.Element | null {
  const t = useTranslations("admin.customers.block");
  const tErr = useTranslations("admin.customers.errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isSelf && !isBlocked) {
    // Admin не может заблокировать себя — кнопка вообще не показывается
    // (защита и в backend через `cannot_self_block`).
    return null;
  }

  const action = isBlocked ? "unblock" : "block";

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/customers/${userId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      if (res.ok && body.ok) {
        toast.success(isBlocked ? t("unblockSuccess") : t("blockSuccess"));
        setOpen(false);
        setReason("");
        router.refresh();
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={isBlocked ? "outline" : "destructive"}
          data-testid={isBlocked ? "customer-unblock-trigger" : "customer-block-trigger"}
        >
          {isBlocked ? (
            <Undo2 className="mr-2 h-4 w-4" aria-hidden />
          ) : (
            <Ban className="mr-2 h-4 w-4" aria-hidden />
          )}
          {isBlocked ? t("unblockTrigger") : t("blockTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isBlocked ? t("unblockTitle") : t("blockTitle")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3" data-testid="customer-block-form">
          <p className="text-sm text-muted-foreground">
            {isBlocked ? t("unblockHelp") : t("blockHelp")}
          </p>
          <div>
            <Label htmlFor="block-reason">{t("reason")}</Label>
            <textarea
              id="block-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              required
              minLength={3}
              maxLength={500}
              placeholder={t("reasonPlaceholder")}
              className="min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
              data-testid="customer-block-reason"
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" data-testid="customer-block-error">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              variant={isBlocked ? "default" : "destructive"}
              disabled={submitting}
              data-testid="customer-block-submit"
            >
              {submitting ? t("submitting") : isBlocked ? t("unblockSubmit") : t("blockSubmit")}
            </Button>
          </DialogFooter>
        </form>
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
    "cannot_self_block",
    "already_blocked",
    "not_blocked",
    "forbidden",
    "reason_too_short",
    "reason_too_long",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(key as (typeof known)[number]);
  }
  return t("generic");
}

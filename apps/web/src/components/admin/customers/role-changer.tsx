"use client";

/**
 * `<RoleChanger>` (P6-T8) — UI для смены роли клиента. Defensive UX:
 *  - Если admin смотрит на самого себя и текущая роль = admin → input
 *    disabled (cannot self-demote, защита и в backend, но UI предупреждает
 *    заранее).
 *  - Reason обязателен (Zod min 3) — поле required.
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface Props {
  userId: string;
  currentRole: "customer" | "manager" | "admin";
  isSelf: boolean;
}

const ROLES = ["customer", "manager", "admin"] as const;

export function RoleChanger({ userId, currentRole, isSelf }: Props): JSX.Element {
  const t = useTranslations("admin.customers.role");
  const tRole = useTranslations("admin.customers.roles");
  const tErr = useTranslations("admin.customers.errors");
  const router = useRouter();
  const [target, setTarget] = useState<(typeof ROLES)[number]>(currentRole);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = isSelf && currentRole === "admin";

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting || blocked) return;
    setError(null);
    if (target === currentRole) {
      setError(tErr("role_unchanged"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/customers/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: target, reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
      if (res.ok && body.ok) {
        toast.success(t("successTitle"), {
          description: t("successBody", { role: tRole(target) }),
        });
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
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border p-4"
      data-testid="customer-role-changer"
    >
      <h3 className="text-sm font-semibold">{t("title")}</h3>
      <p className="text-xs text-muted-foreground">{t("current", { role: tRole(currentRole) })}</p>
      {blocked ? (
        <p className="text-sm text-muted-foreground" data-testid="customer-role-blocked">
          {t("selfBlocked")}
        </p>
      ) : (
        <>
          <fieldset>
            <legend className="sr-only">{t("targetLabel")}</legend>
            <RadioGroup
              value={target}
              onValueChange={(v) => setTarget(v as (typeof ROLES)[number])}
              disabled={submitting}
              className="flex flex-wrap gap-2"
            >
              {ROLES.map((r) => (
                <label
                  key={r}
                  className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  data-testid={`customer-role-target-${r}`}
                >
                  <RadioGroupItem value={r} />
                  {tRole(r)}
                </label>
              ))}
            </RadioGroup>
          </fieldset>
          <div>
            <Label htmlFor="role-reason">{t("reason")}</Label>
            <textarea
              id="role-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              required
              minLength={3}
              maxLength={500}
              placeholder={t("reasonPlaceholder")}
              className="min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none hover:border-foreground/25 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50"
              data-testid="customer-role-reason"
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" data-testid="customer-role-error">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={submitting} data-testid="customer-role-submit">
            {submitting ? t("submitting") : t("submit")}
          </Button>
        </>
      )}
    </form>
  );
}

function translateErr(
  key: string,
  t: ReturnType<typeof useTranslations<"admin.customers.errors">>,
): string {
  const known = [
    "invalid_body",
    "user_not_found",
    "cannot_self_demote",
    "role_unchanged",
    "forbidden",
    "reason_too_short",
    "reason_too_long",
  ] as const;
  if ((known as readonly string[]).includes(key)) {
    return t(key as (typeof known)[number]);
  }
  return t("generic");
}

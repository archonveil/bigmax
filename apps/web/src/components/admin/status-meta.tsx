/**
 * Visual meta для admin filter-select'ов: цветовая точка + опц. иконка
 * для каждого варианта (статус заказа / платежа, роль, провайдер и т.п.).
 *
 * **Не client-component**: `<StatusOption>` — pure render без hooks/handlers,
 * meta maps — plain data + lucide refs. Server components могут импортировать
 * и dot-into этот файл (для `<RoleBadge>`, `<OrderStatusBadge>`,
 * audit-row badges, etc.).
 *
 * `<StatusOption>` рендерит компактный inline-блок: dot 8px slim + иконка
 * 14px + label. Подходит как для SelectItem children, так и для trigger
 * (Radix зеркалит SelectItemText в SelectValue), поэтому селект показывает
 * один и тот же визуал в свёрнутом и развёрнутом состоянии.
 *
 * Палитра выровнена с уже существующими `<OrderStatusBadge>` /
 * `<PaymentStatusBadge>` — admin не путается между списком и карточкой.
 */

import {
  AlertCircle,
  Banknote,
  Box,
  CheckCheck,
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  Headphones,
  Hourglass,
  ListFilter,
  Loader2,
  PackageCheck,
  PackageOpen,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Truck,
  User,
  UserCog,
  Users,
  Wallet,
  Webhook,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Inline option component
// ---------------------------------------------------------------------------

interface StatusOptionProps {
  /** Tailwind class for the colored dot, e.g. "bg-amber-500".
   *  Если не задан — выводится outline-кружок (для "Все..."). */
  dot?: string | undefined;
  /** Опц. иконка справа от точки (вместо неё или вдобавок). */
  icon?: LucideIcon | undefined;
  label: React.ReactNode;
  /** Обёрнутые в muted цвет, для "Все ..." пунктов. */
  muted?: boolean | undefined;
}

export function StatusOption({ dot, icon: Icon, label, muted }: StatusOptionProps): JSX.Element {
  return (
    <span className={cn("flex items-center gap-2", muted && "text-muted-foreground")}>
      {dot ? (
        <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", dot)} />
      ) : (
        <span
          aria-hidden
          className="inline-block h-2 w-2 shrink-0 rounded-full border border-muted-foreground/40"
        />
      )}
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden /> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Order status — выровнено с <OrderStatusBadge>
// ---------------------------------------------------------------------------

export const ORDER_STATUS_META: Record<string, { dot: string; icon: LucideIcon }> = {
  pending: { dot: "bg-amber-500", icon: Hourglass },
  confirmed: { dot: "bg-sky-500", icon: CheckCircle2 },
  packing: { dot: "bg-indigo-500", icon: PackageOpen },
  shipped: { dot: "bg-violet-500", icon: Truck },
  delivered: { dot: "bg-emerald-500", icon: PackageCheck },
  cancelled: { dot: "bg-rose-500", icon: XCircle },
  refunded: { dot: "bg-slate-500", icon: RotateCcw },
};

// ---------------------------------------------------------------------------
// Payment status — выровнено с <PaymentStatusBadge>
// ---------------------------------------------------------------------------

export const PAYMENT_STATUS_META: Record<string, { dot: string; icon: LucideIcon }> = {
  pending: { dot: "bg-amber-500", icon: Hourglass },
  captured: { dot: "bg-emerald-500", icon: CheckCircle2 },
  failed: { dot: "bg-rose-500", icon: AlertCircle },
  cancelled: { dot: "bg-slate-500", icon: X },
  refunded: { dot: "bg-violet-500", icon: RotateCcw },
  partially_refunded: { dot: "bg-indigo-500", icon: RefreshCcw },
};

// ---------------------------------------------------------------------------
// Payment provider
// ---------------------------------------------------------------------------

export const PAYMENT_PROVIDER_META: Record<string, { dot: string; icon: LucideIcon }> = {
  uniteller: { dot: "bg-sky-500", icon: CreditCard },
  cod: { dot: "bg-emerald-500", icon: Banknote },
};

// ---------------------------------------------------------------------------
// Customer role
// ---------------------------------------------------------------------------

export const CUSTOMER_ROLE_META: Record<string, { dot: string; icon: LucideIcon }> = {
  admin: { dot: "bg-rose-500", icon: ShieldCheck },
  manager: { dot: "bg-indigo-500", icon: UserCog },
  customer: { dot: "bg-sky-500", icon: User },
};

// ---------------------------------------------------------------------------
// Audit group
// ---------------------------------------------------------------------------

export const AUDIT_GROUP_META: Record<string, { dot: string; icon: LucideIcon }> = {
  user: { dot: "bg-indigo-500", icon: Users },
  order: { dot: "bg-sky-500", icon: ShoppingBag },
  refund: { dot: "bg-violet-500", icon: RotateCcw },
  recheck: { dot: "bg-amber-500", icon: Eye },
  cancel: { dot: "bg-rose-500", icon: XCircle },
  webhook: { dot: "bg-emerald-500", icon: Webhook },
};

// ---------------------------------------------------------------------------
// Product is-active
// ---------------------------------------------------------------------------

export const ACTIVE_META: Record<string, { dot: string; icon: LucideIcon }> = {
  true: { dot: "bg-emerald-500", icon: Eye },
  false: { dot: "bg-slate-400", icon: EyeOff },
};

// ---------------------------------------------------------------------------
// Bulk-bar / "all" pseudo-meta — для общего "All" пункта.
// ---------------------------------------------------------------------------

export const ALL_FILTER_META = { icon: ListFilter };

// Re-export icons that callers may want for one-off cases (e.g. "all").
export { CheckCheck, Headphones, Loader2, Wallet, Box, ListFilter, type LucideIcon };

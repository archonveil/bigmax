"use client";

import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useRef, useState } from "react";

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
import { buttonVariants } from "@/components/ui/button";

export interface ConfirmOptions {
  /** Bold heading shown above the description. */
  title?: string;
  /** Main message / question. */
  description: string;
  /** Confirm button label. Defaults to common.confirm translation. */
  confirmLabel?: string;
  /** Cancel button label. Defaults to common.cancel translation. */
  cancelLabel?: string;
  /** "destructive" renders the confirm button in red. */
  variant?: "destructive" | "default";
}

export type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({ description: "" });
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    const normalized = typeof options === "string" ? { description: options } : options;
    setOpts(normalized);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  function settle(value: boolean): void {
    setOpen(false);
    resolveRef.current?.(value);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          if (!v) settle(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            {opts.title ? <AlertDialogTitle>{opts.title}</AlertDialogTitle> : null}
            <AlertDialogDescription>{opts.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {opts.cancelLabel ?? t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settle(true)}
              className={
                opts.variant === "destructive"
                  ? buttonVariants({ variant: "destructive" })
                  : undefined
              }
            >
              {opts.confirmLabel ?? t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmDialogProvider>");
  return ctx;
}

"use client";

/**
 * `<LocaleFallbackHint>` + `<CopyFromRuButton>` — общие виджеты для UZ/EN
 * табов admin-форм. Вместе сообщают, что:
 *  - UZ/EN теперь опциональны;
 *  - при пустом значении на storefront-е будет отрисован RU-fallback;
 *  - кликом можно подставить значения из RU-таба (chip → input).
 */

import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export function LocaleFallbackHint(): JSX.Element {
  const t = useTranslations("common");
  return (
    <p
      className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
      data-testid="locale-fallback-hint"
    >
      {t("localeFallbackHint")}
    </p>
  );
}

interface CopyButtonProps {
  onCopy: () => void;
  disabled?: boolean;
  testId?: string;
}

export function CopyFromRuButton({ onCopy, disabled, testId }: CopyButtonProps): JSX.Element {
  const t = useTranslations("common");
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onCopy}
      disabled={disabled ?? false}
      data-testid={testId ?? "copy-from-ru"}
      className="h-8 gap-1.5"
    >
      <Copy className="h-3.5 w-3.5" aria-hidden />
      {t("copyFromRu")}
    </Button>
  );
}

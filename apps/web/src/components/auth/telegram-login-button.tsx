"use client";

/**
 * `<TelegramLoginButton>` — рендерит официальный Telegram Login Widget
 * (https://core.telegram.org/widgets/login) и завершает auth через NextAuth.
 *
 * Поток:
 *   1. Скрипт telegram-widget.js монтируется внутрь нашего div (виджет
 *      iframe-based; должен быть положен inline в DOM, а не в `<head>`,
 *      поэтому `next/script` не подходит — используем classic createElement).
 *   2. Юзер кликает кнопку → popup Telegram'а → подтверждает.
 *   3. Telegram вызывает глобальный callback `onTelegramAuth(user)`,
 *      имя которого мы передали через `data-onauth`. Мы регистрируем
 *      callback на `window.__bigmaxTelegramAuth` (per-component unique
 *      имя на случай, если виджет окажется на странице несколько раз).
 *   4. Callback зовёт `signIn("telegram", payload)` — NextAuth credentials
 *      provider верифицирует HMAC и создаёт сессию.
 *
 * Без `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` компонент не рендерится
 * (return null) — caller не показывает Telegram-секцию вообще.
 *
 * Re-mount на изменение `colorScheme` (light/dark) — Telegram виджет
 * не поддерживает динамическую смену темы без пересоздания iframe'а.
 */

import { useRouter } from "@bigmax/i18n/navigation";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { useFavorites } from "@/favorites/store";
import { syncFavoritesWithServer } from "@/favorites/sync";

interface TelegramAuthPayload {
  id: string | number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface Props {
  colorScheme?: "light" | "dark";
  size?: "small" | "medium" | "large";
  cornerRadius?: number;
  onError?: (message: string) => void;
}

declare global {
  interface Window {
    [k: `__bigmaxTelegramAuth_${string}`]: ((user: TelegramAuthPayload) => void) | undefined;
  }
}

export function TelegramLoginButton({
  colorScheme = "light",
  size = "large",
  cornerRadius = 8,
  onError,
}: Props): JSX.Element | null {
  const botUsername = process.env["NEXT_PUBLIC_TELEGRAM_BOT_USERNAME"];
  const t = useTranslations("auth.telegram");
  const tErr = useTranslations("auth.errors");
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  // Безопасный globalCallbackName: должен быть валидным JS identifier'ом для
  // подстановки в `data-onauth="onAuth(user)"`. Заменяем все : / - на _.
  const callbackKey = `__bigmaxTelegramAuth_${reactId.replace(/[^a-zA-Z0-9_]/gu, "_")}` as const;
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    if (!botUsername) return;
    const container = containerRef.current;
    if (!container) return;

    // Регистрируем глобальный callback под уникальным именем.
    window[callbackKey] = (user: TelegramAuthPayload): void => {
      void (async (): Promise<void> => {
        setSigning(true);
        const result = await signIn("telegram", {
          id: String(user.id),
          first_name: user.first_name ?? "",
          last_name: user.last_name ?? "",
          username: user.username ?? "",
          photo_url: user.photo_url ?? "",
          auth_date: String(user.auth_date),
          hash: user.hash,
          redirect: false,
        });
        setSigning(false);

        if (!result || result.error) {
          onError?.(tErr("telegramFailed"));
          return;
        }

        // Sync local favorites for guest→user merge (как в email-login).
        try {
          const guestIds = useFavorites.getState().items.map((it) => it.productId);
          if (guestIds.length > 0) await syncFavoritesWithServer(guestIds);
        } catch {
          /* favorites sync — best-effort */
        }
        router.push("/");
        router.refresh();
      })();
    };

    // Монтируем сам widget script в наш контейнер.
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", size);
    script.setAttribute("data-radius", String(cornerRadius));
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", `${callbackKey}(user)`);
    if (colorScheme === "dark") {
      script.setAttribute("data-dark", "1");
    }
    container.appendChild(script);

    return () => {
      // Cleanup: удаляем widget'овый iframe + global callback.
      container.innerHTML = "";
      delete window[callbackKey];
    };
  }, [botUsername, callbackKey, colorScheme, size, cornerRadius, onError, router, tErr]);

  // Если bot не настроен — не показываем секцию вообще (caller прячет UI).
  if (!botUsername) return null;

  return (
    <div className="space-y-2" data-testid="telegram-login">
      <div
        ref={containerRef}
        className="flex justify-center"
        aria-label={t("buttonLabel")}
        aria-busy={signing}
      />
      {signing ? (
        <p className="text-center text-xs text-muted-foreground" role="status">
          {t("signingIn")}
        </p>
      ) : null}
    </div>
  );
}

"use client";

/**
 * `<AuthSessionProvider>` — client-side обёртка над `SessionProvider` из
 * next-auth/react. NextAuth v5 server-side `auth()` работает без неё, но
 * client'ский `useSession()` (для `update()` после mutation профиля,
 * например) требует provider'а в дереве.
 *
 * Mount'ится один раз в `[locale]/layout.tsx`. Сама `SessionProvider` без
 * `session` prop'а лениво фетчит сессию через `/api/auth/session` при
 * первом `useSession()` обращении — для большинства страниц это zero-cost
 * (фетч происходит только если потомок реально использует session-данные).
 */

import { SessionProvider } from "next-auth/react";

export function AuthSessionProvider({ children }: { children: React.ReactNode }): JSX.Element {
  return <SessionProvider>{children}</SessionProvider>;
}

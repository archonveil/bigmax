/**
 * Навигационные хелперы next-intl, обёрнутые вокруг нашего `routing`.
 *
 *   <Link href="/cart" locale="uz">   — авто-префикс локали.
 *   usePathname()                     — текущий путь БЕЗ локали.
 *   useRouter()                       — .push/.replace с опцией locale.
 *
 * Эти символы — client-side; не импортируй из Server Components напрямую,
 * используй server-версии из next-intl/server.
 */

import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);

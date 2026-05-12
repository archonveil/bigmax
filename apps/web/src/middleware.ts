/**
 * Композитный middleware: сначала role-based auth-проверки, потом next-intl.
 *
 * Авторизация читается edge-safe через `getToken` из `next-auth/jwt`
 * (только декод JWT, без Prisma/bcrypt) — поэтому middleware остаётся
 * в Edge Runtime и не тянет Node-only зависимости.
 *
 * Auth.js v5 изменил имя куки с `next-auth.session-token` на
 * `authjs.session-token` (и `__Secure-authjs.session-token` для HTTPS).
 * getToken без явного cookieName не находит сессию — передаём явно.
 *
 * Правила:
 *   - `/admin/*`  + аноним          → `/{locale}/auth/login`
 *   - `/admin/*`  + role=customer   → `/{locale}`
 *   - `/auth/*`   + залогинен       → `/{locale}` (или `/{locale}/admin` для admin/manager)
 *   - всё остальное                 → intlMiddleware (локаль-детекция, hreflang и пр.)
 */

import { routing } from "@bigmax/i18n/routing";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@bigmax/shared-types";
import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import createIntlMiddleware from "next-intl/middleware";

const intlMiddleware = createIntlMiddleware(routing);

const AUTH_PATHS = ["/auth/login", "/auth/register", "/auth/verify"];
const ADMIN_PREFIX = "/admin";

const AUTH_SECRET = process.env["AUTH_SECRET"] ?? process.env["NEXTAUTH_SECRET"] ?? "";

function splitLocale(pathname: string): { locale: Locale; rest: string } {
  // "/ru/admin/foo" → { locale: "ru", rest: "/admin/foo" }
  // "/admin"        → { locale: DEFAULT_LOCALE, rest: "/admin" }
  const match = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  if (match && isLocale(match[1])) {
    return { locale: match[1], rest: match[2] ?? "/" };
  }
  return { locale: DEFAULT_LOCALE, rest: pathname || "/" };
}

function isAuthPath(rest: string): boolean {
  return AUTH_PATHS.some((p) => rest === p || rest.startsWith(`${p}/`));
}

function isAdminPath(rest: string): boolean {
  return rest === ADMIN_PREFIX || rest.startsWith(`${ADMIN_PREFIX}/`);
}

export default async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const { locale, rest } = splitLocale(pathname);

  // Auth.js v5 renamed cookie: next-auth.session-token → authjs.session-token
  const secureCookie = req.nextUrl.protocol === "https:";
  const cookieName = secureCookie ? "__Secure-authjs.session-token" : "authjs.session-token";

  const token = await getToken({ req, secret: AUTH_SECRET, cookieName });
  const isAuthenticated = typeof token?.["id"] === "string";
  const role = token?.["role"];
  const isPrivileged = role === "admin" || role === "manager";

  // 1. Залогиненный юзер не должен видеть формы входа/регистрации.
  if (isAuthenticated && isAuthPath(rest)) {
    const target = isPrivileged ? `/${locale}/admin` : `/${locale}`;
    return NextResponse.redirect(new URL(target, req.url));
  }

  // 2. /admin/* без сессии → /auth/login.
  if (!isAuthenticated && isAdminPath(rest)) {
    const loginUrl = new URL(`/${locale}/auth/login`, req.url);
    return NextResponse.redirect(loginUrl);
  }

  // 3. /admin/* c ролью customer → /{locale} (silent; 403-страницы пока нет).
  if (isAuthenticated && isAdminPath(rest) && !isPrivileged) {
    return NextResponse.redirect(new URL(`/${locale}`, req.url));
  }

  // 4. Всё остальное передаём в next-intl.
  return intlMiddleware(req);
}

export const config = {
  // Исключаем /api, статику Next и файлы с расширением.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};

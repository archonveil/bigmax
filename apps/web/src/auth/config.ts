/**
 * NextAuth.js (Auth.js v5) — конфигурация аутентификации Бигмах.
 *
 * Стратегия сессии: JWT (нет database sessions — чтобы избежать
 * round-trip'а в Postgres на каждый запрос).
 *
 * Три провайдера:
 *   1. `credentials` — email + пароль. Пароль сверяется bcrypt'ом.
 *   2. `otp` — телефон + 6-значный код. Код верифицируется в Redis
 *      через `verifyOtp`. При первом входе создаётся новый User
 *      с ролью `customer` и language = DEFAULT_LOCALE.
 *   3. `telegram` — Telegram Login Widget. Подписанный payload
 *      верифицируется HMAC'ом через `verifyTelegramAuth`. Lookup/upsert
 *      по `telegramId`; первый вход создаёт нового customer'а.
 *
 * JWT содержит `id / role / language / phone / name / email` — последние два
 * добавлены в P1-18 чтобы `/account/profile` рендерил без лишнего PG-roundtrip
 * (только на mutation идём в БД). При обновлении профиля API-route обновляет
 * `User`, и JWT перевыпускается на следующем запросе через NextAuth `update()`.
 */

import { prisma } from "@bigmax/db";
import { DEFAULT_LOCALE, type Locale, type UserRole } from "@bigmax/shared-types";
import { compare } from "bcryptjs";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { verifyOtp } from "@/server/otp";
import { verifyTelegramAuth } from "@/server/telegram-auth";

import { EmailCredentialsSchema, OtpCredentialsSchema, TelegramCredentialsSchema } from "./schemas";

declare module "next-auth" {
  /** Дополнительные поля, которые authorize() кладёт в user. */
  interface User {
    role?: UserRole;
    language?: Locale;
    phone?: string | null;
  }
  interface Session {
    user: {
      id: string;
      role: UserRole;
      language: Locale;
      phone: string | null;
    } & DefaultSession["user"];
  }
}

// JWT-тип из @auth/core — Record<string, unknown>. Модульное augmentation не
// работает надёжно через re-export, поэтому читаем через type guards ниже.

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/login",
  },
  providers: [
    Credentials({
      id: "credentials",
      name: "Email + password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = EmailCredentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (!user?.passwordHash) return null;
        // P6-T8 follow-up (a): блокированные не проходят auth.
        if (user.isBlocked) return null;

        const ok = await compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          role: user.role,
          language: user.language,
        };
      },
    }),
    Credentials({
      id: "otp",
      name: "Phone + OTP",
      credentials: {
        phone: { label: "Phone", type: "tel" },
        code: { label: "Code", type: "text" },
      },
      async authorize(raw) {
        const parsed = OtpCredentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const phone = await verifyOtp(parsed.data.phone, parsed.data.code);
        if (phone === null) return null;

        // Upsert по телефону — первый OTP-вход создаёт пользователя.
        const user = await prisma.user.upsert({
          where: { phone },
          create: {
            phone,
            role: "customer",
            language: DEFAULT_LOCALE,
          },
          update: {},
        });
        // P6-T8 follow-up (a): existing-user может оказаться заблокированным.
        if (user.isBlocked) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          role: user.role,
          language: user.language,
        };
      },
    }),
    Credentials({
      id: "telegram",
      name: "Telegram",
      // NextAuth credentials API по дизайну ожидает строки в payload'е —
      // числовые поля Telegram'а (id, auth_date) приходят как string и
      // coerce'ятся в Zod-схеме.
      credentials: {
        id: { label: "id", type: "text" },
        first_name: { label: "first_name", type: "text" },
        last_name: { label: "last_name", type: "text" },
        username: { label: "username", type: "text" },
        photo_url: { label: "photo_url", type: "text" },
        auth_date: { label: "auth_date", type: "text" },
        hash: { label: "hash", type: "text" },
      },
      async authorize(raw) {
        const parsed = TelegramCredentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const ok = verifyTelegramAuth({
          id: parsed.data.id,
          first_name: parsed.data.first_name,
          last_name: parsed.data.last_name,
          username: parsed.data.username,
          photo_url: parsed.data.photo_url,
          auth_date: parsed.data.auth_date,
          hash: parsed.data.hash,
        });
        if (!ok) return null;

        const fullName =
          [parsed.data.first_name, parsed.data.last_name]
            .filter((s): s is string => Boolean(s && s.trim()))
            .join(" ")
            .trim() || null;

        // Upsert по telegramId. Linking к существующим email/phone-аккаунтам
        // — отдельный flow в account-настройках (не делаем здесь silent merge,
        // чтобы избежать takeover'а: если кто-то знает мой email, не должен
        // через Telegram-логин попасть в мой аккаунт).
        const user = await prisma.user.upsert({
          where: { telegramId: parsed.data.id },
          create: {
            telegramId: parsed.data.id,
            telegramUsername: parsed.data.username ?? null,
            telegramFirstName: parsed.data.first_name ?? null,
            telegramLastName: parsed.data.last_name ?? null,
            telegramPhotoUrl: parsed.data.photo_url ?? null,
            telegramAuthDate: new Date(parsed.data.auth_date * 1000),
            name: fullName,
            avatarUrl: parsed.data.photo_url ?? null,
            role: "customer",
            language: DEFAULT_LOCALE,
          },
          update: {
            telegramUsername: parsed.data.username ?? null,
            telegramFirstName: parsed.data.first_name ?? null,
            telegramLastName: parsed.data.last_name ?? null,
            telegramPhotoUrl: parsed.data.photo_url ?? null,
            telegramAuthDate: new Date(parsed.data.auth_date * 1000),
          },
        });
        if (user.isBlocked) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          role: user.role,
          language: user.language,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger, session: updateSession }) {
      if (user) {
        token["id"] = user.id;
        token["role"] = user.role;
        token["language"] = user.language;
        token["phone"] = user.phone ?? null;
        token["bigmaxName"] = user.name ?? null;
        token["bigmaxEmail"] = user.email ?? null;
      }
      // P1-18 follow-up: `useSession().update({ name, email, language })` после
      // mutation профиля прокидывает свежие значения в JWT без re-login.
      if (trigger === "update" && updateSession && typeof updateSession === "object") {
        const u = updateSession as Record<string, unknown>;
        if (typeof u["name"] === "string") token["bigmaxName"] = u["name"];
        if (u["name"] === null) token["bigmaxName"] = null;
        if (typeof u["email"] === "string") token["bigmaxEmail"] = u["email"];
        if (typeof u["language"] === "string") token["language"] = u["language"];
        if (typeof u["phone"] === "string") token["phone"] = u["phone"];
        if (u["phone"] === null) token["phone"] = null;
      }
      return token;
    },
    session({ session, token }) {
      const id = token["id"];
      const role = token["role"];
      const language = token["language"];
      const phone = token["phone"];
      const name = token["bigmaxName"];
      const email = token["bigmaxEmail"];

      if (typeof id === "string") session.user.id = id;
      if (typeof role === "string") session.user.role = role as UserRole;
      if (typeof language === "string") session.user.language = language as Locale;
      session.user.phone = typeof phone === "string" ? phone : null;
      // P1-18: `name` / `email` в DefaultSession.user типизированы как string;
      // в БД у нас nullable. Cast'им один раз, чтобы не вырезать поля из augment'а.
      session.user.name = (typeof name === "string" ? name : null) as string;
      session.user.email = (typeof email === "string" ? email : null) as string;

      return session;
    },
  },
});

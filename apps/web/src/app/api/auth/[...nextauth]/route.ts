/**
 * NextAuth.js route handler. Обслуживает:
 *   - GET  /api/auth/session          — текущая сессия
 *   - POST /api/auth/callback/...     — коллбэки провайдеров
 *   - POST /api/auth/signin/...       — логин через credentials/otp
 *   - POST /api/auth/signout
 *   - GET  /api/auth/csrf, /api/auth/providers — служебные
 */

import { handlers } from "@/auth";

export const { GET, POST } = handlers;

/**
 * Шрифты Бигмах:
 *   - Nunito — body (latin + cyrillic, regular/medium/semibold/bold).
 *   - Comfortaa — заголовки (medium/semibold/bold).
 *
 * next/font/google делает self-hosting + preload + automatic font-display swap,
 * никакого CDN, никакого layout shift. Переменные подставляются в tailwind
 * через --font-body и --font-heading.
 */

import { Comfortaa, Nunito } from "next/font/google";

export const fontBody = Nunito({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const fontHeading = Comfortaa({
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600", "700"],
  variable: "--font-heading",
  display: "swap",
});

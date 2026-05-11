/**
 * Catch-all для unmatched routes внутри локали. Next.js 14 роутит сперва
 * по явным page.tsx, и только когда совпадений нет — попадает сюда. Мы
 * сразу вызываем `notFound()`, что активирует локальный
 * `/[locale]/not-found.tsx`.
 *
 * Без этого файла unmatched `/ru/bogus` рендерит дефолтный Next-овский
 * 404 вместо нашей кастомной страницы.
 */

import { notFound } from "next/navigation";

export default function NotFoundCatchAll(): never {
  notFound();
}

/**
 * `<Highlight>` — рендерит `text` с подсветкой подстроки `query`.
 *
 * Поведение:
 *  - case-insensitive match (как и server-side ILIKE-фильтр).
 *  - подсвечиваются ВСЕ вхождения, а не только первое.
 *  - если `query` пуст или не найдено — рендерим plain text без обёртки.
 *  - text может быть `null/undefined` → возвращаем то, что есть (для
 *    удобной композиции в табличных колонках).
 *  - `query` экранируется перед regex'ом (защита от ReDoS на user input).
 *
 * Использование:
 *   <Highlight text={user.email} query={query.q} />
 *
 * Стили: `<mark>` — yellow подложка + dark text для контраста на обоих
 * темах (light/dark). Bold чтобы подсветка была заметнее в плотных
 * таблицах. Класс `bg-yellow-200 dark:bg-yellow-700/40 text-foreground
 * font-medium rounded-sm px-0.5`.
 */

import { Fragment } from "react";

interface Props {
  text: string | null | undefined;
  query: string | null | undefined;
  /** Доп. класс на root `<span>`, если нужен truncate/text-color от parent'а. */
  className?: string;
}

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(s: string): string {
  return s.replace(ESCAPE_RE, "\\$&");
}

export function Highlight({ text, query, className }: Props): JSX.Element {
  const safe = text ?? "";
  const needle = (query ?? "").trim();

  if (needle === "" || safe === "") {
    return <span className={className}>{safe}</span>;
  }

  const re = new RegExp(`(${escapeRegex(needle)})`, "gi");
  const parts = safe.split(re);

  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.toLowerCase() === needle.toLowerCase() ? (
          <mark
            key={i}
            className="rounded-sm bg-yellow-200 px-0.5 font-medium text-foreground dark:bg-yellow-500/30"
          >
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </span>
  );
}

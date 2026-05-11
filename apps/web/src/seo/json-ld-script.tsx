import type { LdNode } from "./json-ld";

interface JsonLdProps {
  data: LdNode | LdNode[];
}

/**
 * Встраивает `application/ld+json` в SSR-разметку. Массив — для страниц
 * с несколькими блоками (например, BreadcrumbList + ItemList).
 *
 * `suppressHydrationWarning` — защита от различий сериализации в client-
 * hydration фазе (не ожидается, но дешёвая страховка).
 */
export function JsonLd({ data }: JsonLdProps): JSX.Element {
  const payload = Array.isArray(data) ? data : [data];
  return (
    <>
      {payload.map((node, i) => (
        <script
          key={i}
          type="application/ld+json"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: JSON.stringify(node) }}
        />
      ))}
    </>
  );
}

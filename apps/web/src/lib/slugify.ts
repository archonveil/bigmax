/**
 * `slugify(input, options)` — детерминированный преобразователь строки в
 * URL-safe slug. Покрывает три скрипта, с которыми работает Бигмах:
 *  - Latin (с диакритикой: é→e, ñ→n);
 *  - Russian Cyrillic (а..я + ё, ъ/ь дропаются);
 *  - Uzbek Cyrillic дополнительные буквы (ў/қ/ғ/ҳ).
 *
 * Алгоритм:
 *  1. lowercase
 *  2. Unicode NFD + drop combining marks → латинские диакритики становятся ASCII
 *  3. Cyrillic char-map → ASCII (BGN/PCGN-ish, но без апострофов; "ё"→"yo")
 *  4. Common symbols → words ("&"→" and ", "+"→" plus ")
 *  5. Любой не-[a-z0-9] → разделитель
 *  6. Свернуть повторы разделителя; срезать с краёв
 *  7. Cap по `maxLength` (с очисткой висящего разделителя)
 *
 * Опции:
 *  - `separator`: "-" (kebab — default, для slug'ов товаров/категорий/брендов)
 *                 или "_" (snake, для атрибут-key-ев и option-value).
 *  - `maxLength`: default 64.
 *  - `allowDigits`: default true. Если slug должен начинаться с буквы (как
 *    `attr.key`), используйте дополнительный guard в caller'е.
 *
 * Pure-функция, без зависимостей. Тестируется в `slugify.test.ts`.
 */

const RU_CYRILLIC_MAP: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

// Узбекская кириллица — дополнительные буквы поверх русской.
// `ў` → "o" (упрощение от oʻ; апостроф мы всё равно стрипаем)
// `қ` → "q", `ғ` → "g", `ҳ` → "h"
const UZ_CYRILLIC_MAP: Record<string, string> = {
  ў: "o",
  қ: "q",
  ғ: "g",
  ҳ: "h",
};

const SYMBOL_MAP: Record<string, string> = {
  "&": " and ",
  "+": " plus ",
  "%": " percent ",
  "@": " at ",
  "#": " ",
  "/": " ",
  "\\": " ",
};

export interface SlugifyOptions {
  /** Разделитель: "-" (kebab) или "_" (snake). Default — "-". */
  separator?: "-" | "_";
  /** Макс. длина результата. Default — 64. */
  maxLength?: number;
}

export function slugify(input: string, options: SlugifyOptions = {}): string {
  const sep = options.separator ?? "-";
  const maxLen = options.maxLength ?? 64;

  if (!input) return "";

  // 1. lowercase + NFC. NFC компонует разложенные пары (`и`+breve→`й`,
  //    `у`+breve→`ў`, `е`+diaeresis→`ё`) в precomposed-форму, чтобы
  //    char-by-char map ниже сматчил эти символы.
  let s = input.toLowerCase().normalize("NFC");

  // 2. Cyrillic char-by-char (Russian + Uzbek). До NFD чтобы breve/diaeresis
  //    не отвалились раньше времени.
  s = s
    .split("")
    .map((c) => RU_CYRILLIC_MAP[c] ?? UZ_CYRILLIC_MAP[c] ?? SYMBOL_MAP[c] ?? c)
    .join("");

  // 3. NFD + drop combining marks для оставшихся Latin-диакритик
  //    (é→e, ñ→n, à→a). Cyrillic уже превращён в ASCII, так что не
  //    тронется.
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");

  // 4. Заменяем любой не-[a-z0-9] на разделитель.
  s = s.replace(/[^a-z0-9]+/g, sep);

  // 5. Свернуть повторы разделителя.
  const sepRe = new RegExp(`\\${sep}+`, "g");
  s = s.replace(sepRe, sep);

  // 6. Срезать sep с краёв.
  const trimRe = new RegExp(`^\\${sep}+|\\${sep}+$`, "g");
  s = s.replace(trimRe, "");

  // 7. Cap по длине; если на границе остался разделитель — стрипаем.
  if (s.length > maxLen) {
    s = s.slice(0, maxLen).replace(new RegExp(`\\${sep}+$`), "");
  }

  return s;
}

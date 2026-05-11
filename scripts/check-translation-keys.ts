/**
 * Проверка, что ключи переводов одинаковы во всех трёх локалях.
 * Источник правды — ru.json. Фейлит CI, если uz.json или en.json
 * имеют пропущенные или лишние ключи.
 *
 * Запуск:  pnpm run check:i18n
 */

import fs from "node:fs";
import path from "node:path";

const LOCALES = ["ru", "uz", "en"] as const;
const REFERENCE_LOCALE = "ru";
const MESSAGES_DIR = path.resolve(process.cwd(), "packages/i18n/messages");

function collectKeys(value: unknown, prefix = ""): Set<string> {
  const out = new Set<string>();
  if (value === null || typeof value !== "object") return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      for (const nested of collectKeys(v, full)) out.add(nested);
    } else {
      out.add(full);
    }
  }
  return out;
}

function readLocale(locale: string): Set<string> {
  const filePath = path.join(MESSAGES_DIR, `${locale}.json`);
  if (!fs.existsSync(filePath)) {
    console.error(`[check:i18n] missing dictionary: ${filePath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return collectKeys(JSON.parse(raw));
}

function diff(reference: Set<string>, other: Set<string>): { missing: string[]; extra: string[] } {
  const missing: string[] = [];
  const extra: string[] = [];
  for (const k of reference) {
    if (!other.has(k)) missing.push(k);
  }
  for (const k of other) {
    if (!reference.has(k)) extra.push(k);
  }
  return { missing: missing.sort(), extra: extra.sort() };
}

function main(): void {
  const refKeys = readLocale(REFERENCE_LOCALE);
  let hasError = false;

  for (const locale of LOCALES) {
    if (locale === REFERENCE_LOCALE) continue;
    const keys = readLocale(locale);
    const { missing, extra } = diff(refKeys, keys);

    if (missing.length > 0) {
      hasError = true;
      console.error(
        `\n[${locale}] missing ${missing.length} key(s) (present in ${REFERENCE_LOCALE}):`,
      );
      for (const k of missing) console.error(`  - ${k}`);
    }
    if (extra.length > 0) {
      hasError = true;
      console.error(`\n[${locale}] extra ${extra.length} key(s) (not in ${REFERENCE_LOCALE}):`);
      for (const k of extra) console.error(`  + ${k}`);
    }
  }

  if (hasError) {
    console.error(`\n❌ Translation keys diverge between locales.`);
    process.exit(1);
  }

  console.info(
    `✓ Translation keys are in sync across ${LOCALES.length} locales (${refKeys.size} keys each).`,
  );
}

main();

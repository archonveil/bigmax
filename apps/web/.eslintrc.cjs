/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ["next/core-web-vitals"],
  rules: {
    // Next.js-парсер не прокидывает parserOptions.project — правило падает на .mjs.
    "@typescript-eslint/consistent-type-imports": "off",
    // App Router, pages/ каталога нет.
    "@next/next/no-html-link-for-pages": "off",
  },
};

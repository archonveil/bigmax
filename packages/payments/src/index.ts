/**
 * Корневой public API `@bigmax/payments`.
 *
 * Сейчас экспортирует только Uniteller-домен. COD (§5.1, P4-T8) будет жить
 * в `./cod/` с соответствующим re-export'ом.
 */

export * as uniteller from "./uniteller";

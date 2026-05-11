/**
 * FF-003 · pure helper для определения «high-risk» изменений feature-flag.
 *
 * Живёт в `apps/web/src/lib/` (не в `server/`) чтобы import'иться из
 * client-компонентов без подтягивания Prisma в client-bundle. Server-side
 * `admin-features.ts` re-export'ит для backwards compatibility.
 *
 * Список «опасных» ключей и условий — _не_ конфигурируется через БД
 * специально: это часть production-safety policy кода. Если admin
 * привыкает кликать через confirmation для текущих ключей, добавление
 * нового опасного ключа должно требовать ревью кода, а не «admin поменял
 * флаг в БД».
 */

/**
 * True если предлагаемое изменение значения для этого feature-key
 * считается «high-risk» и требует confirmation-modal'а в UI.
 *
 * Правила:
 *  - `loyalty.spend_enabled` → high-risk если new value `"false"`
 *    (отключение списания баллов в production = массовый UX-impact).
 *  - `brand.maintenance_message` → high-risk если new value непустой
 *    (включение banner'а на всём сайте).
 *  - `loyalty.earn_percent` → high-risk если new value > 5 (5x от default —
 *    легко словить опечатку «50» вместо «5» на маркетинговой акции).
 */
export function isHighRiskFeatureChange(key: string, newValue: string): boolean {
  switch (key) {
    case "loyalty.spend_enabled":
      return newValue === "false";
    case "brand.maintenance_message":
      return newValue.trim().length > 0;
    case "loyalty.earn_percent": {
      const n = Number.parseFloat(newValue);
      return Number.isFinite(n) && n > 5;
    }
    default:
      return false;
  }
}

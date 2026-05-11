/**
 * Полифилл `localStorage` для node-окружения Vitest — обязателен ДО
 * импорта store'ов с `persist` middleware (иначе zustand на module-init
 * видит `undefined` и отключает persistence).
 *
 * Per-тест очистка — в beforeEach самого теста через `.clear()` плюс
 * state-reset самого store'а.
 */

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  key(i: number): string | null {
    return Array.from(this.data.keys())[i] ?? null;
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

if (!("localStorage" in globalThis)) {
  (globalThis as { localStorage: Storage }).localStorage = new MemoryStorage();
}

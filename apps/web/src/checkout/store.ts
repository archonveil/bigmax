/**
 * Zustand + persist store для многошагового чекаута. Хранит промежуточные
 * данные юзера + текущий шаг под ключом `bigmax:checkout-draft`.
 *
 * Scope P4-T1 — только клиентский state; реальный POST /api/checkout/pay и
 * создание Order + Uniteller Signature — в P4-T5.
 *
 * Решения:
 *   - Persist чтобы юзер не потерял введённое при случайном reload'е.
 *   - `reset()` вызывается после успешного placeOrder в P4-T5 → чистит draft.
 *   - Шаги — литеральный union, `stepIndex` вычисляется в UI из массива.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const CHECKOUT_STORAGE_KEY = "bigmax:checkout-draft";
export const CHECKOUT_VERSION = 1;

export const CHECKOUT_STEPS = ["contacts", "address", "delivery", "payment", "review"] as const;
export type CheckoutStep = (typeof CHECKOUT_STEPS)[number];

export interface CheckoutContacts {
  name: string;
  email: string;
  phone: string;
}

export interface CheckoutAddress {
  region: string;
  city: string;
  /** Optional fields: пустая строка = «не указано». Конверсия в `null`
   *  произойдёт в P4-T5 при записи в БД (Address.district и т.п.). */
  district: string;
  street: string;
  house: string;
  apartment: string;
  landmark: string;
  phone: string;
}

export type DeliveryMethod = "courier" | "pickup";

export interface CheckoutDelivery {
  method: DeliveryMethod;
  /** "" если method='courier'; обязателен при 'pickup'. */
  branchId: string;
  /** addressId если выбран сохранённый адрес (auth), иначе используется CheckoutAddress. */
  savedAddressId?: string | null;
  comment: string;
}

export type PaymentMethod = "uniteller" | "cod";

export interface CheckoutPayment {
  method: PaymentMethod;
}

interface CheckoutState {
  hydrated: boolean;
  currentStep: CheckoutStep;
  contacts: Partial<CheckoutContacts>;
  address: Partial<CheckoutAddress>;
  delivery: Partial<CheckoutDelivery>;
  payment: Partial<CheckoutPayment>;
  /** P7-T2: сколько баллов «Бигмах Бонус» юзер решил потратить. Server
   *  все равно clamp'ает на свой баланс через `clampPointsToSpend` — клиент
   *  не authoritative. 0 = не списываем. */
  loyaltyPointsToSpend: number;
}

interface CheckoutActions {
  setStep(step: CheckoutStep): void;
  setContacts(data: CheckoutContacts): void;
  setAddress(data: CheckoutAddress): void;
  setDelivery(data: CheckoutDelivery): void;
  setPayment(data: CheckoutPayment): void;
  setLoyaltyPointsToSpend(points: number): void;
  reset(): void;
  _reset(): void;
}

export type CheckoutStore = CheckoutState & CheckoutActions;

const initialState: CheckoutState = {
  hydrated: false,
  currentStep: "contacts",
  contacts: {},
  address: {},
  delivery: {},
  payment: {},
  loyaltyPointsToSpend: 0,
};

export const useCheckout = create<CheckoutStore>()(
  persist(
    (set) => ({
      ...initialState,

      setStep(step) {
        set({ currentStep: step });
      },
      setContacts(data) {
        set({ contacts: data });
      },
      setAddress(data) {
        set({ address: data });
      },
      setDelivery(data) {
        set({ delivery: data });
      },
      setPayment(data) {
        set({ payment: data });
      },
      setLoyaltyPointsToSpend(points) {
        const clean = Number.isFinite(points) && points >= 0 ? Math.floor(points) : 0;
        set({ loyaltyPointsToSpend: clean });
      },
      reset() {
        set({ ...initialState, hydrated: true });
      },
      _reset() {
        set(initialState);
      },
    }),
    {
      name: CHECKOUT_STORAGE_KEY,
      version: CHECKOUT_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        currentStep: s.currentStep,
        contacts: s.contacts,
        address: s.address,
        delivery: s.delivery,
        payment: s.payment,
        loyaltyPointsToSpend: s.loyaltyPointsToSpend,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);

export function useCheckoutHydrated(): boolean {
  return useCheckout((s) => s.hydrated);
}

export function stepIndex(step: CheckoutStep): number {
  return CHECKOUT_STEPS.indexOf(step);
}

export function nextStep(step: CheckoutStep): CheckoutStep | null {
  const i = stepIndex(step);
  return i >= 0 && i < CHECKOUT_STEPS.length - 1 ? CHECKOUT_STEPS[i + 1]! : null;
}

export function prevStep(step: CheckoutStep): CheckoutStep | null {
  const i = stepIndex(step);
  return i > 0 ? CHECKOUT_STEPS[i - 1]! : null;
}

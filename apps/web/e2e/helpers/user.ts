/**
 * Хелперы для создания эфемерных тестовых юзеров в e2e-прогонах.
 * Не трогаем seed-аккаунты (admin@bigmax.uz и т.п.) — используем
 * уникальные email'ы с префиксом `e2e-`, создаём в beforeEach,
 * удаляем в afterEach.
 */

import { prisma } from "@bigmax/db";
import { hash } from "bcryptjs";

export interface TestUserInput {
  email: string;
  password: string;
  name?: string;
  role?: "customer" | "admin" | "manager";
}

export async function createTestUser(input: TestUserInput): Promise<void> {
  const passwordHash = await hash(input.password, 10);
  await prisma.user.upsert({
    where: { email: input.email },
    update: {
      passwordHash,
      name: input.name ?? "E2E User",
      role: input.role ?? "customer",
    },
    create: {
      email: input.email,
      passwordHash,
      name: input.name ?? "E2E User",
      role: input.role ?? "customer",
      language: "ru",
    },
  });
}

export async function deleteTestUser(email: string): Promise<void> {
  // Порядок важен: сначала payment/items (FK → order), потом orders (FK → user),
  // потом addresses (FK → user), потом сам user. Всё — по цепочке user.email
  // чтобы случайно не снести чужие записи в shared-БД.
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return;
  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    select: { id: true, number: true },
  });
  const orderIds = orders.map((o) => o.id);
  const orderNumbers = orders.map((o) => o.number);
  if (orderIds.length > 0) {
    // PaymentLog → Payment → Order — FK-зависимый порядок.
    const paymentIds = (
      await prisma.payment.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true },
      })
    ).map((p) => p.id);
    if (paymentIds.length > 0) {
      await prisma.paymentLog.deleteMany({ where: { paymentId: { in: paymentIds } } });
    }
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  // WebhookEvent ссылается на Order_IDP=Order.number строкой (не FK), поэтому
  // удаляем по списку номеров. Иначе stale-события переживают тестовые прогоны
  // и ломают P4-T12-assertions «events.length === 0» на одинаковых seq-числах.
  if (orderNumbers.length > 0) {
    await prisma.webhookEvent.deleteMany({
      where: { externalId: { in: orderNumbers } },
    });
  }
  await prisma.address.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

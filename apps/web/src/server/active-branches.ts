/**
 * `getActiveBranches()` — кешированный список активных филиалов.
 *
 * Branches меняются несколько раз в год; раньше каждый рендер `/checkout` бил
 * `prisma.storeBranch.findMany` (P1-11 в OPTIMIZATION_PLAN.md). С `unstable_cache`
 * это один query на ~30 минут на инстанс, инвалидация — `revalidateTag('branches')`
 * из admin-ручек CRUD филиалов.
 */

import { prisma } from "@bigmax/db";
import { unstable_cache } from "next/cache";

export interface ActiveBranch {
  id: string;
  nameRu: string;
  nameUz: string;
  nameEn: string;
  addressRu: string;
  addressUz: string;
  addressEn: string;
  phone: string | null;
  workingHours: string | null;
  latitude: number | null;
  longitude: number | null;
}

export const ACTIVE_BRANCHES_TAG = "branches";

export const getActiveBranches = unstable_cache(
  async (): Promise<ActiveBranch[]> => {
    return prisma.storeBranch.findMany({
      where: { isActive: true },
      orderBy: { nameRu: "asc" },
      select: {
        id: true,
        nameRu: true,
        nameUz: true,
        nameEn: true,
        addressRu: true,
        addressUz: true,
        addressEn: true,
        phone: true,
        workingHours: true,
        latitude: true,
        longitude: true,
      },
    });
  },
  ["active-branches"],
  { revalidate: 1800, tags: [ACTIVE_BRANCHES_TAG] },
);

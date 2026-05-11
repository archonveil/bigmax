/**
 * Минимальный dev-seed для Бигмах.
 *
 * Создаёт:
 *   - 1 admin, 1 manager, 1 customer (пароль: password123, hash через bcryptjs);
 *   - 3 категории (Одежда / Игрушки / Питание) на 3 языках;
 *   - 2 бренда (Chicco, Pampers);
 *   - 1 филиал в Ташкенте;
 *   - 3 товара, по 2 варианта, с остатками на филиале;
 *   - 1 промокод WELCOME10 (10% скидка).
 *
 * Идемпотентен — использует upsert по уникальным ключам.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { hash as bcryptHash } from "bcryptjs";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.info("[seed] старт");

  // ----- Users -----------------------------------------------------
  const passwordHash = await bcryptHash("password123", 10);

  const [admin, manager, customer] = await Promise.all([
    prisma.user.upsert({
      where: { email: "admin@bigmax.uz" },
      update: {},
      create: {
        email: "admin@bigmax.uz",
        phone: "+998901000001",
        passwordHash,
        name: "Админ Бигмах",
        role: "admin",
        language: "ru",
      },
    }),
    prisma.user.upsert({
      where: { email: "manager@bigmax.uz" },
      update: {},
      create: {
        email: "manager@bigmax.uz",
        phone: "+998901000002",
        passwordHash,
        name: "Менеджер Бигмах",
        role: "manager",
        language: "ru",
      },
    }),
    prisma.user.upsert({
      where: { email: "customer@bigmax.uz" },
      update: {},
      create: {
        email: "customer@bigmax.uz",
        phone: "+998901000003",
        passwordHash,
        name: "Тестовый клиент",
        role: "customer",
        language: "ru",
        loyaltyPoints: 500,
      },
    }),
  ]);
  console.info(`[seed] users: admin=${admin.id}, manager=${manager.id}, customer=${customer.id}`);

  // ----- Categories (F2: 9+ категорий, 2-уровневая иерархия) -------
  // Top-level: 9 основных категорий.
  const TOP_CATEGORIES = [
    { slug: "clothing", ru: "Одежда", uz: "Kiyim", en: "Clothing" },
    { slug: "toys", ru: "Игрушки", uz: "O'yinchoqlar", en: "Toys" },
    { slug: "food", ru: "Питание", uz: "Oziq-ovqat", en: "Food" },
    { slug: "diapers", ru: "Подгузники", uz: "Tagliklar", en: "Diapers" },
    { slug: "hygiene", ru: "Гигиена", uz: "Gigiena", en: "Hygiene" },
    { slug: "feeding", ru: "Кормление", uz: "Ovqatlantirish", en: "Feeding" },
    { slug: "strollers", ru: "Коляски", uz: "Aravachalar", en: "Strollers" },
    { slug: "furniture", ru: "Мебель", uz: "Mebel", en: "Furniture" },
    { slug: "accessories", ru: "Аксессуары", uz: "Aksessuarlar", en: "Accessories" },
  ] as const;

  const categoriesBySlug: Record<string, { id: string; slug: string }> = {};
  for (let i = 0; i < TOP_CATEGORIES.length; i += 1) {
    const c = TOP_CATEGORIES[i]!;
    const created = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { nameRu: c.ru, nameUz: c.uz, nameEn: c.en, order: i + 1, parentId: null },
      create: {
        slug: c.slug,
        nameRu: c.ru,
        nameUz: c.uz,
        nameEn: c.en,
        order: i + 1,
      },
    });
    categoriesBySlug[c.slug] = { id: created.id, slug: created.slug };
  }

  // Sub-categories: иерархия произвольной глубины (multi-level support).
  // Пока заводим под clothing / toys / food + один уровень-3 пример
  // (`clothing > outerwear > jackets`) для проверки рендера дерева.
  const SUB_CATEGORIES = [
    {
      slug: "bodysuits",
      parent: "clothing",
      ru: "Боди и комбинезоны",
      uz: "Bodi va kombinezonlar",
      en: "Bodysuits & rompers",
    },
    {
      slug: "outerwear",
      parent: "clothing",
      ru: "Верхняя одежда",
      uz: "Ustki kiyim",
      en: "Outerwear",
    },
    {
      slug: "toys-educational",
      parent: "toys",
      ru: "Развивающие",
      uz: "Rivojlantiruvchi",
      en: "Educational",
    },
    { slug: "toys-plush", parent: "toys", ru: "Плюшевые", uz: "Yumshoq", en: "Plush" },
    { slug: "porridge", parent: "food", ru: "Каши", uz: "Bo'tqalar", en: "Porridges" },
    { slug: "formula", parent: "food", ru: "Смеси", uz: "Aralashmalar", en: "Formula" },
    // Depth-3 (внуки): outerwear → jackets / coats. Подтверждает, что
    // multi-level рендер UI и transitive product-filter работают.
    {
      slug: "jackets",
      parent: "outerwear",
      ru: "Куртки",
      uz: "Kurtkalar",
      en: "Jackets",
    },
    {
      slug: "coats",
      parent: "outerwear",
      ru: "Пальто",
      uz: "Paltolar",
      en: "Coats",
    },
  ] as const;

  for (let i = 0; i < SUB_CATEGORIES.length; i += 1) {
    const c = SUB_CATEGORIES[i]!;
    const parent = categoriesBySlug[c.parent]!;
    const created = await prisma.category.upsert({
      where: { slug: c.slug },
      update: {
        nameRu: c.ru,
        nameUz: c.uz,
        nameEn: c.en,
        order: i + 1,
        parentId: parent.id,
      },
      create: {
        slug: c.slug,
        nameRu: c.ru,
        nameUz: c.uz,
        nameEn: c.en,
        order: i + 1,
        parentId: parent.id,
      },
    });
    categoriesBySlug[c.slug] = { id: created.id, slug: created.slug };
  }
  const catFeeding = categoriesBySlug["feeding"]!;
  const catHygiene = categoriesBySlug["hygiene"]!;
  console.info(`[seed] categories: ${TOP_CATEGORIES.length} top + ${SUB_CATEGORIES.length} sub`);

  // ----- Category attributes (P6-T3 follow-up "professional") --------
  // Seed-конфиг: ключ + kind + per-locale labels + (для enum) options.
  // Идемпотентен через @@unique([categoryId, key]) — повторный seed
  // обновит labels/options без потери данных.
  type SeedField =
    | {
        key: string;
        kind: "enum" | "multiselect";
        labels: { ru: string; uz: string; en: string };
        order: number;
        isFilterable?: boolean;
        options: Array<{
          value: string;
          labelRu: string;
          labelUz: string;
          labelEn: string;
          color?: string;
        }>;
      }
    | {
        key: string;
        kind: "range";
        labels: { ru: string; uz: string; en: string };
        order: number;
        isFilterable?: boolean;
        min?: number;
        max?: number;
        unit?: { ru: string; uz: string; en: string };
      }
    | {
        key: string;
        kind: "boolean";
        labels: { ru: string; uz: string; en: string };
        order: number;
        isFilterable?: boolean;
      };

  // Color attribute — opt-in via per-option `color` hex. Filter UI рендерит
  // swatch grid вместо dropdown; в attribute-table показывается dot перед label.
  // **Kind: multiselect** — товар c вариантами white+blue+red попадает под
  // фильтр для каждого цвета. attributes.color хранится как Array<value> и
  // auto-derived из variant.color через `syncProductColorFromVariants()`.
  const ATTR_COLOR: SeedField = {
    key: "color",
    kind: "multiselect",
    order: 0,
    labels: { ru: "Цвет", uz: "Rang", en: "Color" },
    options: [
      { value: "white", labelRu: "Белый", labelUz: "Oq", labelEn: "White", color: "#ffffff" },
      { value: "beige", labelRu: "Бежевый", labelUz: "Bej", labelEn: "Beige", color: "#f5e9d4" },
      { value: "pink", labelRu: "Розовый", labelUz: "Pushti", labelEn: "Pink", color: "#fbcfe8" },
      { value: "red", labelRu: "Красный", labelUz: "Qizil", labelEn: "Red", color: "#ef4444" },
      { value: "yellow", labelRu: "Жёлтый", labelUz: "Sariq", labelEn: "Yellow", color: "#facc15" },
      { value: "green", labelRu: "Зелёный", labelUz: "Yashil", labelEn: "Green", color: "#22c55e" },
      { value: "blue", labelRu: "Синий", labelUz: "Ko'k", labelEn: "Blue", color: "#3b82f6" },
      {
        value: "navy",
        labelRu: "Тёмно-синий",
        labelUz: "To'q ko'k",
        labelEn: "Navy",
        color: "#1e3a8a",
      },
      {
        value: "purple",
        labelRu: "Фиолетовый",
        labelUz: "Siyohrang",
        labelEn: "Purple",
        color: "#a855f7",
      },
      { value: "grey", labelRu: "Серый", labelUz: "Kulrang", labelEn: "Grey", color: "#9ca3af" },
      { value: "black", labelRu: "Чёрный", labelUz: "Qora", labelEn: "Black", color: "#111827" },
    ],
  };

  const ATTR_FABRIC: SeedField = {
    key: "fabric",
    kind: "enum",
    order: 1,
    labels: { ru: "Ткань", uz: "Mato", en: "Fabric" },
    options: [
      { value: "cotton", labelRu: "Хлопок", labelUz: "Paxta", labelEn: "Cotton" },
      { value: "wool", labelRu: "Шерсть", labelUz: "Jun", labelEn: "Wool" },
      { value: "synthetic", labelRu: "Синтетика", labelUz: "Sintetika", labelEn: "Synthetic" },
      { value: "mixed", labelRu: "Смешанный", labelUz: "Aralash", labelEn: "Mixed" },
    ],
  };
  const ATTR_SEASON: SeedField = {
    key: "season",
    kind: "enum",
    order: 2,
    labels: { ru: "Сезон", uz: "Mavsum", en: "Season" },
    options: [
      { value: "summer", labelRu: "Лето", labelUz: "Yoz", labelEn: "Summer" },
      { value: "winter", labelRu: "Зима", labelUz: "Qish", labelEn: "Winter" },
      { value: "demi", labelRu: "Демисезон", labelUz: "Demizon", labelEn: "Spring/Autumn" },
      {
        value: "all",
        labelRu: "Всесезонный",
        labelUz: "Har qanday mavsum",
        labelEn: "All seasons",
      },
    ],
  };
  const ATTR_MATERIAL: SeedField = {
    key: "material",
    kind: "enum",
    order: 1,
    labels: { ru: "Материал", uz: "Material", en: "Material" },
    options: [
      { value: "plastic", labelRu: "Пластик", labelUz: "Plastik", labelEn: "Plastic" },
      { value: "wood", labelRu: "Дерево", labelUz: "Yog'och", labelEn: "Wood" },
      { value: "fabric", labelRu: "Ткань", labelUz: "Mato", labelEn: "Fabric" },
      { value: "silicone", labelRu: "Силикон", labelUz: "Silikon", labelEn: "Silicone" },
      { value: "metal", labelRu: "Металл", labelUz: "Metall", labelEn: "Metal" },
      { value: "mdf", labelRu: "МДФ", labelUz: "MDF", labelEn: "MDF" },
    ],
  };
  const ATTR_HAS_SOUND: SeedField = {
    key: "hasSound",
    kind: "boolean",
    order: 2,
    labels: { ru: "Со звуком", uz: "Ovozli", en: "With sound" },
  };
  const ATTR_IS_ORGANIC: SeedField = {
    key: "isOrganic",
    kind: "boolean",
    order: 2,
    labels: { ru: "Органический", uz: "Organik", en: "Organic" },
  };
  const ATTR_VOLUME_ML: SeedField = {
    key: "volumeMl",
    kind: "range",
    order: 1,
    labels: { ru: "Объём", uz: "Hajmi", en: "Volume" },
    min: 0,
    unit: { ru: "мл", uz: "ml", en: "ml" },
  };
  const ATTR_DIAPER_SIZE: SeedField = {
    key: "diaperSize",
    kind: "enum",
    order: 1,
    labels: { ru: "Размер подгузника", uz: "Taglik o'lchami", en: "Diaper size" },
    options: [
      { value: "1", labelRu: "1 (Newborn)", labelUz: "1 (Newborn)", labelEn: "1 (Newborn)" },
      { value: "2", labelRu: "2 (Mini)", labelUz: "2 (Mini)", labelEn: "2 (Mini)" },
      { value: "3", labelRu: "3 (Midi)", labelUz: "3 (Midi)", labelEn: "3 (Midi)" },
      { value: "4", labelRu: "4 (Maxi)", labelUz: "4 (Maxi)", labelEn: "4 (Maxi)" },
      { value: "5", labelRu: "5 (Junior)", labelUz: "5 (Junior)", labelEn: "5 (Junior)" },
      { value: "6", labelRu: "6 (XL)", labelUz: "6 (XL)", labelEn: "6 (XL)" },
    ],
  };
  const ATTR_PIECES_PER_PACK: SeedField = {
    key: "piecesPerPack",
    kind: "range",
    order: 2,
    labels: { ru: "Штук в упаковке", uz: "Qadoqdagi dona", en: "Pieces per pack" },
    min: 0,
  };
  const ATTR_STROLLER_TYPE: SeedField = {
    key: "strollerType",
    kind: "enum",
    order: 1,
    labels: { ru: "Тип коляски", uz: "Aravacha turi", en: "Stroller type" },
    options: [
      { value: "light", labelRu: "Прогулочная", labelUz: "Prog'ulka", labelEn: "Lightweight" },
      { value: "full", labelRu: "Универсальная", labelUz: "Universal", labelEn: "Full-featured" },
      { value: "jogger", labelRu: "Джоггер", labelUz: "Jogger", labelEn: "Jogger" },
    ],
  };
  const ATTR_MAX_WEIGHT_KG: SeedField = {
    key: "maxWeightKg",
    kind: "range",
    order: 2,
    labels: { ru: "Макс. нагрузка", uz: "Maks. yuklama", en: "Max weight" },
    min: 0,
    unit: { ru: "кг", uz: "kg", en: "kg" },
  };

  // Атрибуты определяем ТОЛЬКО на топ-категориях; subcategories наследуют
  // их через read-time merge в `getCategoryAttributes`. Если subcategory
  // нужен дополнительный/уникальный атрибут — добавляем сюда явной записью.
  const ATTR_PER_CATEGORY: Record<string, SeedField[]> = {
    clothing: [ATTR_COLOR, ATTR_FABRIC, ATTR_SEASON],
    toys: [ATTR_COLOR, ATTR_MATERIAL, ATTR_HAS_SOUND],
    food: [ATTR_VOLUME_ML, ATTR_IS_ORGANIC],
    diapers: [ATTR_DIAPER_SIZE, ATTR_PIECES_PER_PACK],
    hygiene: [ATTR_VOLUME_ML],
    feeding: [ATTR_VOLUME_ML, { ...ATTR_MATERIAL, order: 2 }],
    strollers: [ATTR_COLOR, ATTR_STROLLER_TYPE, ATTR_MAX_WEIGHT_KG],
    furniture: [ATTR_COLOR, ATTR_MATERIAL],
    accessories: [ATTR_COLOR],
  };

  let attrCount = 0;
  for (const [slug, fields] of Object.entries(ATTR_PER_CATEGORY)) {
    const cat = categoriesBySlug[slug];
    if (!cat) continue;
    for (const f of fields) {
      const base = {
        labelRu: f.labels.ru,
        labelUz: f.labels.uz,
        labelEn: f.labels.en,
        kind: f.kind,
        order: f.order,
        isFilterable: f.isFilterable ?? true,
        isRequired: false,
        options:
          f.kind === "enum" || f.kind === "multiselect"
            ? (f.options as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        min: f.kind === "range" ? (f.min ?? null) : null,
        max: f.kind === "range" ? (f.max ?? null) : null,
        step: null,
        unitRu: f.kind === "range" && f.unit ? f.unit.ru : null,
        unitUz: f.kind === "range" && f.unit ? f.unit.uz : null,
        unitEn: f.kind === "range" && f.unit ? f.unit.en : null,
      };
      await prisma.categoryAttribute.upsert({
        where: { categoryId_key: { categoryId: cat.id, key: f.key } },
        update: base,
        create: { categoryId: cat.id, key: f.key, ...base },
      });
      attrCount += 1;
    }
  }

  // Cleanup: удаляем subcategory-атрибуты, которые дублируют ключ родителя.
  // С появлением inheritance такие записи стали мёртвым весом: read-merge
  // считает их override'ом, чего seed не хочет — duplicate данные на разных
  // уровнях. Безопасный no-op на свежей БД (subcategory rows нет с этим
  // seed'ом), необходим на старых dev-БД с предыдущими прогонами.
  let cleanedAttrs = 0;
  for (const sub of SUB_CATEGORIES) {
    const parent = categoriesBySlug[sub.parent];
    const child = categoriesBySlug[sub.slug];
    if (!parent || !child) continue;
    const parentKeys = await prisma.categoryAttribute.findMany({
      where: { categoryId: parent.id },
      select: { key: true },
    });
    const parentKeySet = parentKeys.map((r: { key: string }) => r.key);
    if (parentKeySet.length === 0) continue;
    const result = await prisma.categoryAttribute.deleteMany({
      where: { categoryId: child.id, key: { in: parentKeySet } },
    });
    cleanedAttrs += result.count;
  }
  console.info(
    `[seed] category attributes: ${attrCount} rows seeded, ${cleanedAttrs} duplicate subcategory rows cleaned`,
  );

  // ----- Brands --------------------------------------------------
  const BRANDS = [
    {
      slug: "chicco",
      name: "Chicco",
      country: "Италия",
      description: "Итальянский бренд товаров для детей с 1958 года",
    },
    {
      slug: "pampers",
      name: "Pampers",
      country: "США",
      description: "Подгузники и средства гигиены для малышей",
    },
    {
      slug: "avent",
      name: "Philips Avent",
      country: "Нидерланды",
      description: "Бутылочки, молокоотсосы и аксессуары для кормления",
    },
    {
      slug: "hipp",
      name: "HiPP",
      country: "Германия",
      description: "Органическое детское питание и каши",
    },
    {
      slug: "nuby",
      name: "Nuby",
      country: "США",
      description: "Пустышки, бутылочки и обучающая посуда",
    },
  ] as const;

  const brandsBySlug: Record<string, { id: string; slug: string }> = {};
  for (const b of BRANDS) {
    const created = await prisma.brand.upsert({
      where: { slug: b.slug },
      update: { name: b.name, country: b.country, description: b.description },
      create: b,
    });
    brandsBySlug[b.slug] = { id: created.id, slug: created.slug };
  }
  const brandChicco = brandsBySlug["chicco"]!;
  const brandPampers = brandsBySlug["pampers"]!;
  const brandAvent = brandsBySlug["avent"]!;
  const brandHipp = brandsBySlug["hipp"]!;
  const brandNuby = brandsBySlug["nuby"]!;
  console.info(`[seed] brands: ${Object.keys(brandsBySlug).length}`);

  // ----- Store branches -------------------------------------------
  // 3 точки в Ташкенте — центр, Юнусабад, Чиланзар. Детерминированные id
  // чтобы e2e/тесты могли на них ссылаться и seed был идемпотентным.
  const branchTashkent = await prisma.storeBranch.upsert({
    where: { id: "seed-branch-tashkent-main" },
    update: {
      phone: "+998712000000",
      workingHours: "Пн-Вс 09:00–21:00",
      latitude: 41.311081,
      longitude: 69.240562,
    },
    create: {
      id: "seed-branch-tashkent-main",
      nameRu: "Ташкент — Центр",
      nameUz: "Toshkent — Markaz",
      nameEn: "Tashkent — Main",
      addressRu: "г. Ташкент, ул. Амира Темура, 1",
      addressUz: "Toshkent sh., Amir Temur ko'chasi, 1",
      addressEn: "Tashkent, Amir Temur str., 1",
      phone: "+998712000000",
      workingHours: "Пн-Вс 09:00–21:00",
      latitude: 41.311081,
      longitude: 69.240562,
    },
  });
  await prisma.storeBranch.upsert({
    where: { id: "seed-branch-tashkent-yunusabad" },
    update: {
      phone: "+998712111122",
      workingHours: "Пн-Вс 09:00–22:00",
      latitude: 41.3666,
      longitude: 69.2896,
    },
    create: {
      id: "seed-branch-tashkent-yunusabad",
      nameRu: "Ташкент — Юнусабад",
      nameUz: "Toshkent — Yunusobod",
      nameEn: "Tashkent — Yunusabad",
      addressRu: "г. Ташкент, Юнусабадский район, ул. А. Темура, 107Б",
      addressUz: "Toshkent sh., Yunusobod tumani, A. Temur ko'chasi, 107B",
      addressEn: "Tashkent, Yunusabad district, A. Temur str., 107B",
      phone: "+998712111122",
      workingHours: "Пн-Вс 09:00–22:00",
      latitude: 41.3666,
      longitude: 69.2896,
    },
  });
  await prisma.storeBranch.upsert({
    where: { id: "seed-branch-tashkent-chilonzor" },
    update: {
      phone: "+998712333344",
      workingHours: "Пн-Вс 10:00–21:00",
      latitude: 41.2852,
      longitude: 69.2093,
    },
    create: {
      id: "seed-branch-tashkent-chilonzor",
      nameRu: "Ташкент — Чиланзар",
      nameUz: "Toshkent — Chilonzor",
      nameEn: "Tashkent — Chilanzar",
      addressRu: "г. Ташкент, Чиланзарский район, ул. Бунёдкор, 4",
      addressUz: "Toshkent sh., Chilonzor tumani, Bunyodkor ko'chasi, 4",
      addressEn: "Tashkent, Chilanzar district, Bunyodkor str., 4",
      phone: "+998712333344",
      workingHours: "Пн-Вс 10:00–21:00",
      latitude: 41.2852,
      longitude: 69.2093,
    },
  });
  console.info(`[seed] branches: 3 Tashkent locations`);

  // ----- Products -------------------------------------------------
  type SeedVariant = {
    sku: string;
    color?: string;
    size?: string;
    priceCents: number;
    oldPriceCents?: number;
    stock: number;
  };
  type SeedProduct = {
    slug: string;
    categoryId: string;
    brandId: string;
    nameRu: string;
    nameUz: string;
    nameEn: string;
    descriptionRu: string;
    descriptionUz: string;
    descriptionEn: string;
    ageFromMonths?: number;
    ageToMonths?: number;
    gender: "unisex" | "boy" | "girl";
    isFeatured: boolean;
    /** Category-specific атрибуты (см. apps/web/src/catalog/category-attributes.ts). */
    attributes?: Record<string, string | number | boolean | string[]>;
    variants: SeedVariant[];
  };

  // Цены в тийнах (UZS × 100). 1 500 000 сум = 150_000_000 тийнов.
  const products: SeedProduct[] = [
    {
      slug: "chicco-bodysuit-cotton",
      categoryId: categoriesBySlug["bodysuits"]!.id,
      brandId: brandChicco.id,
      nameRu: "Боди Chicco, хлопок",
      nameUz: "Chicco bodi, paxta",
      nameEn: "Chicco cotton bodysuit",
      descriptionRu: "Мягкое хлопковое боди с длинным рукавом.",
      descriptionUz: "Uzun yengli yumshoq paxta bodi.",
      descriptionEn: "Soft cotton bodysuit with long sleeves.",
      ageFromMonths: 0,
      ageToMonths: 12,
      gender: "unisex",
      isFeatured: true,
      attributes: { color: ["white", "blue"], fabric: "cotton", season: "all" },
      variants: [
        { sku: "CH-BD-62-WH", color: "white", size: "62", priceCents: 12_000_000, stock: 25 },
        {
          sku: "CH-BD-68-BL",
          color: "blue",
          size: "68",
          priceCents: 12_000_000,
          oldPriceCents: 15_000_000,
          stock: 18,
        },
      ],
    },
    {
      slug: "chicco-first-dreams-projector",
      categoryId: categoriesBySlug["toys-educational"]!.id,
      brandId: brandChicco.id,
      nameRu: "Музыкальный проектор Chicco First Dreams",
      nameUz: "Chicco First Dreams musiqali proyektor",
      nameEn: "Chicco First Dreams musical projector",
      descriptionRu: "Успокаивает и убаюкивает, проецирует звёзды на потолок.",
      descriptionUz: "Tinchlantiradi va uxlatadi, shiftga yulduzlar aks etadi.",
      descriptionEn: "Soothes and lulls to sleep, projects stars onto the ceiling.",
      ageFromMonths: 0,
      ageToMonths: 36,
      gender: "unisex",
      isFeatured: true,
      attributes: { color: ["pink", "blue"], material: "plastic", hasSound: true },
      variants: [
        { sku: "CH-PROJ-PINK", color: "pink", priceCents: 45_000_000, stock: 8 },
        { sku: "CH-PROJ-BLUE", color: "blue", priceCents: 45_000_000, stock: 6 },
      ],
    },
    {
      slug: "pampers-premium-care-3",
      categoryId: categoriesBySlug["diapers"]!.id,
      brandId: brandPampers.id,
      nameRu: "Подгузники Pampers Premium Care размер 3",
      nameUz: "Pampers Premium Care tagliklari 3-o'lcham",
      nameEn: "Pampers Premium Care diapers size 3",
      descriptionRu: "Мягкие подгузники для детей 6–10 кг, упаковка 60 шт.",
      descriptionUz: "6–10 kg bolalar uchun yumshoq tagliklar, 60 dona.",
      descriptionEn: "Soft diapers for 6–10 kg babies, 60 pcs pack.",
      ageFromMonths: 3,
      ageToMonths: 12,
      gender: "unisex",
      isFeatured: true,
      attributes: { diaperSize: "3", piecesPerPack: 60 },
      variants: [
        { sku: "PM-PC-3-60", size: "60 шт", priceCents: 18_500_000, stock: 40 },
        { sku: "PM-PC-3-120", size: "120 шт", priceCents: 34_900_000, stock: 22 },
      ],
    },
    {
      slug: "avent-natural-bottle-260",
      categoryId: catFeeding.id,
      brandId: brandAvent.id,
      nameRu: "Бутылочка Avent Natural 260 мл",
      nameUz: "Avent Natural 260 ml shishasi",
      nameEn: "Avent Natural bottle 260 ml",
      descriptionRu: "Широкая соска с лепестками — максимально близка к груди мамы.",
      descriptionUz: "Onaning ko'kragiga maksimal yaqin bo'lgan keng so'rg'ich.",
      descriptionEn: "Wide petal-shaped teat that mimics the natural shape of the breast.",
      ageFromMonths: 1,
      ageToMonths: 18,
      gender: "unisex",
      isFeatured: true,
      attributes: { volumeMl: 260, material: "plastic" },
      variants: [
        { sku: "AV-BT-260-CLR", color: "прозрачный", priceCents: 8_900_000, stock: 35 },
        { sku: "AV-BT-260-2PK", size: "2 шт", priceCents: 15_900_000, stock: 20 },
      ],
    },
    {
      slug: "hipp-bio-cereal-oat",
      categoryId: categoriesBySlug["porridge"]!.id,
      brandId: brandHipp.id,
      nameRu: "Каша HiPP овсяная молочная, 250 г",
      nameUz: "HiPP sutli suli bo'tqasi, 250 g",
      nameEn: "HiPP organic oat milk cereal, 250 g",
      descriptionRu: "Органическая каша с первых месяцев прикорма.",
      descriptionUz: "Birinchi oylardan organik bo'tqa.",
      descriptionEn: "Organic cereal from the first months of complementary feeding.",
      ageFromMonths: 4,
      ageToMonths: 24,
      gender: "unisex",
      isFeatured: false,
      attributes: { volumeMl: 250, isOrganic: true },
      variants: [{ sku: "HP-CR-OAT-250", size: "250 г", priceCents: 4_200_000, stock: 50 }],
    },
    {
      slug: "nuby-cherry-pacifier",
      categoryId: catHygiene.id,
      brandId: brandNuby.id,
      nameRu: "Пустышка Nuby силиконовая, 0–6 мес",
      nameUz: "Nuby silikon so'rg'ich, 0–6 oy",
      nameEn: "Nuby silicone pacifier, 0–6 mo",
      descriptionRu: "Ортодонтическая форма, BPA-free.",
      descriptionUz: "Ortodontik shakl, BPA'siz.",
      descriptionEn: "Orthodontic shape, BPA-free.",
      ageFromMonths: 0,
      ageToMonths: 6,
      gender: "unisex",
      isFeatured: false,
      // Пустышка — volume не релевантен. attributes намеренно не задаём.
      variants: [
        { sku: "NB-PAC-PK", color: "pink", priceCents: 2_500_000, stock: 60 },
        { sku: "NB-PAC-BL", color: "blue", priceCents: 2_500_000, stock: 55 },
      ],
    },
  ];

  for (const p of products) {
    const productFields = {
      categoryId: p.categoryId,
      brandId: p.brandId,
      nameRu: p.nameRu,
      nameUz: p.nameUz,
      nameEn: p.nameEn,
      descriptionRu: p.descriptionRu,
      descriptionUz: p.descriptionUz,
      descriptionEn: p.descriptionEn,
      ageFromMonths: p.ageFromMonths,
      ageToMonths: p.ageToMonths,
      gender: p.gender,
      isFeatured: p.isFeatured,
      attributes: p.attributes ?? Prisma.DbNull,
    };
    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      update: productFields,
      create: { slug: p.slug, ...productFields },
    });

    for (const v of p.variants) {
      const variant = await prisma.productVariant.upsert({
        where: { sku: v.sku },
        update: { color: v.color, size: v.size, priceCents: v.priceCents },
        create: {
          sku: v.sku,
          productId: product.id,
          color: v.color,
          size: v.size,
          priceCents: v.priceCents,
          oldPriceCents: v.oldPriceCents,
        },
      });

      await prisma.stock.upsert({
        where: {
          variantId_branchId: { variantId: variant.id, branchId: branchTashkent.id },
        },
        update: { quantity: v.stock },
        create: {
          variantId: variant.id,
          branchId: branchTashkent.id,
          quantity: v.stock,
          reserved: 0,
        },
      });
    }
    console.info(`[seed] product: ${product.slug} (${p.variants.length} variants)`);
  }

  // ----- Product images (placeholder через placehold.co до появления реальных фото) ----------
  // Цвета — брендовая палитра из design tokens (P0-T7).
  const PLACEHOLDER_IMAGES: Record<string, string[]> = {
    "chicco-bodysuit-cotton": [
      "https://placehold.co/800x800/A7F3D0/1f2937?text=Chicco+Body",
      "https://placehold.co/800x800/7DD3FC/1f2937?text=Chicco+Body+Back",
    ],
    "chicco-first-dreams-projector": [
      "https://placehold.co/800x800/A7F3D0/1f2937?text=Chicco+Projector",
      "https://placehold.co/800x800/FDBA74/1f2937?text=Night+Light",
    ],
    "pampers-premium-care-3": [
      "https://placehold.co/800x800/7DD3FC/1f2937?text=Pampers+Premium",
      "https://placehold.co/800x800/BAE6FD/1f2937?text=Size+3",
    ],
    "avent-natural-bottle-260": [
      "https://placehold.co/800x800/FDBA74/1f2937?text=Avent+Natural",
      "https://placehold.co/800x800/FED7AA/1f2937?text=260ml",
    ],
    "hipp-bio-cereal-oat": [
      "https://placehold.co/800x800/BEF264/1f2937?text=HiPP+Bio+Oat",
      "https://placehold.co/800x800/D9F99D/1f2937?text=250g",
    ],
    "nuby-cherry-pacifier": [
      "https://placehold.co/800x800/F9A8D4/1f2937?text=Nuby+Pacifier",
      "https://placehold.co/800x800/FBCFE8/1f2937?text=0-6m",
    ],
  };

  let imageCount = 0;
  for (const [slug, urls] of Object.entries(PLACEHOLDER_IMAGES)) {
    const product = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!product) continue;
    // Удаляем старые картинки продукта (идемпотентность — при повторном seed'е
    // не плодим дубликаты, у ProductImage нет unique-ключа на url+productId).
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    for (let i = 0; i < urls.length; i += 1) {
      await prisma.productImage.create({
        data: {
          productId: product.id,
          url: urls[i]!,
          alt: slug,
          order: i,
        },
      });
      imageCount += 1;
    }
  }
  console.info(`[seed] product images: ${imageCount}`);

  // ----- Mock products (dev volume) -------------------------------
  // Генерим 100 товаров для нагрузки пагинации/фильтров/поиска. Slug'и
  // `mock-N-<cat>` не пересекаются с каноничными — upsert идемпотентен.
  const categorySlugs = [
    ...TOP_CATEGORIES.map((c) => c.slug),
    ...SUB_CATEGORIES.map((c) => c.slug),
  ];
  const brandSlugs = BRANDS.map((b) => b.slug);
  const AGES: Array<{ from?: number; to?: number }> = [
    { from: 0, to: 6 },
    { from: 6, to: 12 },
    { from: 12, to: 24 },
    { from: 24, to: 36 },
    { from: 0, to: 36 },
    {}, // без возрастных ограничений
  ];
  const GENDERS: Array<"unisex" | "boy" | "girl"> = ["unisex", "unisex", "boy", "girl"];
  const SIZES = ["S", "M", "L", "XL", "62", "68", "74", "80"];
  const PALETTE = ["A7F3D0", "7DD3FC", "FDBA74", "F9A8D4", "BEF264", "FED7AA", "BAE6FD"];

  // Детерминированный генератор атрибутов по category slug + n.
  const FABRICS = ["cotton", "wool", "synthetic", "mixed"];
  const SEASONS = ["summer", "winter", "demi", "all"];
  const MATERIALS_TOYS = ["plastic", "wood", "fabric", "silicone"];
  const MATERIALS_FEEDING = ["plastic", "silicone"];
  const MATERIALS_FURNITURE = ["wood", "plastic", "mdf"];
  const STROLLER_TYPES = ["light", "full", "jogger"];
  const VOLUMES = [100, 200, 250, 400, 500, 1000];
  const DIAPER_SIZES = ["1", "2", "3", "4", "5", "6"];
  const PIECES_PER_PACK = [20, 40, 60, 80, 100, 120];
  const MAX_WEIGHT_KG = [10, 15, 20, 25, 30];
  // Single source of truth для цветов variants. Должно совпадать с
  // ATTR_COLOR options[].value. attributes.color на товаре деривится
  // из набора уникальных variant.color после upsert'а вариантов.
  const COLOR_VALUES = [
    "white",
    "beige",
    "pink",
    "red",
    "yellow",
    "green",
    "blue",
    "navy",
    "purple",
    "grey",
    "black",
  ];
  // Какие категории имеют ATTR_COLOR в config'е → им заполняем
  // attributes.color из variant'ов (как делает sync в runtime).
  const COLOR_CATEGORIES = new Set([
    "clothing",
    "bodysuits",
    "outerwear",
    "toys",
    "toys-educational",
    "toys-plush",
    "strollers",
    "furniture",
    "accessories",
  ]);

  /** Атрибуты товара БЕЗ color — color заполняется отдельно из variants. */
  function mockAttributes(n: number, catSlug: string): Prisma.InputJsonValue | undefined {
    switch (catSlug) {
      case "clothing":
      case "bodysuits":
      case "outerwear":
        return {
          fabric: FABRICS[n % FABRICS.length]!,
          season: SEASONS[n % SEASONS.length]!,
        };
      case "toys":
      case "toys-educational":
      case "toys-plush":
        return {
          material: MATERIALS_TOYS[n % MATERIALS_TOYS.length]!,
          hasSound: n % 2 === 0,
        };
      case "food":
      case "porridge":
      case "formula":
        return {
          volumeMl: VOLUMES[n % VOLUMES.length]!,
          isOrganic: n % 3 === 0,
        };
      case "diapers":
        return {
          diaperSize: DIAPER_SIZES[n % DIAPER_SIZES.length]!,
          piecesPerPack: PIECES_PER_PACK[n % PIECES_PER_PACK.length]!,
        };
      case "hygiene":
        return { volumeMl: VOLUMES[n % VOLUMES.length]! };
      case "feeding":
        return {
          volumeMl: VOLUMES[n % VOLUMES.length]!,
          material: MATERIALS_FEEDING[n % MATERIALS_FEEDING.length]!,
        };
      case "strollers":
        return {
          strollerType: STROLLER_TYPES[n % STROLLER_TYPES.length]!,
          maxWeightKg: MAX_WEIGHT_KG[n % MAX_WEIGHT_KG.length]!,
        };
      case "furniture":
        return { material: MATERIALS_FURNITURE[n % MATERIALS_FURNITURE.length]! };
      case "accessories":
        return undefined;
      default:
        return undefined;
    }
  }

  const MOCK_COUNT = 100;
  let mockCreated = 0;
  for (let n = 1; n <= MOCK_COUNT; n += 1) {
    const catSlug = categorySlugs[n % categorySlugs.length]!;
    const brSlug = brandSlugs[n % brandSlugs.length]!;
    const cat = categoriesBySlug[catSlug]!;
    const br = brandsBySlug[brSlug]!;
    const age = AGES[n % AGES.length]!;
    const gender = GENDERS[n % GENDERS.length]!;
    const isFeatured = n % 7 === 0;
    // Цена 200 000..4 000 000 сум в тийнах, детерминировано.
    const basePriceCents = 20_000_000 + ((n * 37) % 380) * 1_000_000;
    const variantCount = 1 + (n % 3);
    const slug = `mock-${String(n).padStart(3, "0")}-${catSlug}`;
    const nameSuffix = `#${String(n).padStart(3, "0")}`;
    const attrs = mockAttributes(n, catSlug);
    const productFields = {
      categoryId: cat.id,
      brandId: br.id,
      nameRu: `Mock-товар ${nameSuffix}`,
      nameUz: `Mock mahsulot ${nameSuffix}`,
      nameEn: `Mock product ${nameSuffix}`,
      descriptionRu: `Тестовый товар для нагрузки каталога, категория ${catSlug}.`,
      descriptionUz: `Katalog yuklamasi uchun test mahsuloti, kategoriya ${catSlug}.`,
      descriptionEn: `Synthetic catalog fixture, category ${catSlug}.`,
      ageFromMonths: age.from ?? null,
      ageToMonths: age.to ?? null,
      gender,
      isFeatured,
      // Prisma Json? принимает `Prisma.DbNull`/`JsonNull`, но не литеральный `null`
      // при `strict: true` + `exactOptionalPropertyTypes`.
      attributes: attrs ?? Prisma.DbNull,
    };
    const product = await prisma.product.upsert({
      where: { slug },
      update: productFields,
      create: { slug, ...productFields },
    });

    // Variant colors берём из единого `COLOR_VALUES`. Категории без
    // ATTR_COLOR (food, diapers, hygiene, feeding) — color = null,
    // вариант различается только размером.
    const isColorCategory = COLOR_CATEGORIES.has(catSlug);
    const variantColors: string[] = [];
    for (let v = 0; v < variantCount; v += 1) {
      const sku = `MOCK-${String(n).padStart(3, "0")}-V${v + 1}`;
      const price = basePriceCents + v * 500_000;
      // Каждая 4-я позиция со скидкой; каждая 9-я out-of-stock (для фильтра «в наличии»).
      const oldPrice = n % 4 === 0 ? Math.floor(price * 1.25) : undefined;
      const stock = n % 9 === 0 ? 0 : 5 + ((n * (v + 1)) % 40);
      const color = isColorCategory ? COLOR_VALUES[(n + v) % COLOR_VALUES.length]! : null;
      const size = variantCount > 1 ? SIZES[(n + v) % SIZES.length]! : undefined;
      if (color) variantColors.push(color);

      const variant = await prisma.productVariant.upsert({
        where: { sku },
        update: { priceCents: price, oldPriceCents: oldPrice ?? null, color, size },
        create: {
          sku,
          productId: product.id,
          color,
          size,
          priceCents: price,
          oldPriceCents: oldPrice,
        },
      });

      await prisma.stock.upsert({
        where: { variantId_branchId: { variantId: variant.id, branchId: branchTashkent.id } },
        update: { quantity: stock },
        create: {
          variantId: variant.id,
          branchId: branchTashkent.id,
          quantity: stock,
          reserved: 0,
        },
      });
    }

    // attributes.color — derived from variant colors (single source of truth).
    // Дублирует runtime `syncProductColorFromVariants`, чтобы catalog-фильтр
    // и detail-страница после `prisma db seed` сразу матчились с card-swatch.
    if (isColorCategory && variantColors.length > 0) {
      const distinctColors = Array.from(new Set(variantColors));
      const baseAttrs = (
        attrs && typeof attrs === "object" && !Array.isArray(attrs) ? attrs : {}
      ) as Record<string, unknown>;
      await prisma.product.update({
        where: { id: product.id },
        data: {
          attributes: { ...baseAttrs, color: distinctColors } as Prisma.InputJsonValue,
        },
      });
    }

    // Одно placeholder-изображение на товар — детерминированный цвет из палитры.
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    const bg = PALETTE[n % PALETTE.length]!;
    await prisma.productImage.create({
      data: {
        productId: product.id,
        url: `https://placehold.co/800x800/${bg}/1f2937?text=Mock+${String(n).padStart(3, "0")}`,
        alt: slug,
        order: 0,
      },
    });
    mockCreated += 1;
  }
  console.info(`[seed] mock products: ${mockCreated}`);

  // ----- Stock backfill -------------------------------------------
  // Гарантируем Stock(quantity=0) для каждого (variant × active branch).
  // Закрывает старые variant'ы без Stock-row'ов (которые иначе не
  // отображаются на /admin/stock и не могут получить quantity через
  // Adjust-диалог). `skipDuplicates: true` делает операцию идемпотентной.
  const activeBranches = await prisma.storeBranch.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  const allVariants = await prisma.productVariant.findMany({ select: { id: true } });
  if (activeBranches.length > 0 && allVariants.length > 0) {
    const rows: Array<{ variantId: string; branchId: string; quantity: number; reserved: number }> =
      [];
    for (const v of allVariants) {
      for (const b of activeBranches) {
        rows.push({ variantId: v.id, branchId: b.id, quantity: 0, reserved: 0 });
      }
    }
    const result = await prisma.stock.createMany({ data: rows, skipDuplicates: true });
    console.info(`[seed] stock backfill: ${result.count} new (variant × branch) zero-rows`);
  }

  // ----- Promo ----------------------------------------------------
  const promo = await prisma.promo.upsert({
    where: { code: "WELCOME10" },
    update: {},
    create: {
      code: "WELCOME10",
      type: "percent",
      value: 10,
      minOrderCents: 10_000_000, // от 100 000 сум
      isActive: true,
    },
  });
  console.info(`[seed] promo: ${promo.code}`);

  console.info("[seed] готово");
}

main()
  .catch((err: unknown) => {
    console.error("[seed] ошибка:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

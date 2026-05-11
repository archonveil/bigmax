/**
 * GET /api/search?q=...
 *
 * Легковесный эндпоинт для dropdown-автодополнения `<SearchBox>` —
 * возвращает топ-8 товаров по ILIKE-матчу без пагинации и без count.
 * Полная страница результатов — `/[locale]/search?q=...`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getSearchSuggestions } from "@/server/catalog";

const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const parsed = SearchQuerySchema.safeParse({
    q: request.nextUrl.searchParams.get("q") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ results: [] });
  }

  const results = await getSearchSuggestions(parsed.data.q, 8);
  return NextResponse.json(
    { results },
    {
      headers: {
        // 10-секундный кеш на границе CDN для одинаковых запросов.
        "cache-control": "public, s-maxage=10, stale-while-revalidate=60",
      },
    },
  );
}

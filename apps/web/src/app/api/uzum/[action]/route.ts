import { type NextRequest } from "next/server";

import { handleUzumWebhook } from "../../webhooks/uzum/route-handler";

export async function POST(
  req: NextRequest,
  { params }: { params: { action: string } }
): Promise<Response> {
  return handleUzumWebhook(req, params.action);
}

export async function GET(
  req: NextRequest,
  { params }: { params: { action: string } }
): Promise<Response> {
  return handleUzumWebhook(req, params.action);
}

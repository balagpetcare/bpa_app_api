/**
 * Legacy campaign payment callbacks — delegate to unified Strategy Pattern webhook handler.
 */

import { handleUnifiedWebhook } from "../../payments/paymentOrchestrator.service";
import type { WebhookHandleResult } from "../../payments/payment.types";

function normalizeQuery(query: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (v != null) out[k] = String(v);
  }
  return out;
}

export async function handleBkashCallback(
  query: Record<string, string | undefined>
): Promise<WebhookHandleResult & { error?: string }> {
  return handleUnifiedWebhook({ query: normalizeQuery(query) });
}

export async function handleNagadCallback(
  body: Record<string, unknown>
): Promise<WebhookHandleResult & { error?: string }> {
  return handleUnifiedWebhook({ body: body || {} });
}

export async function handleSslCommerzIpn(
  body: Record<string, string>
): Promise<WebhookHandleResult & { error?: string }> {
  return handleUnifiedWebhook({ body: body || {} });
}

export async function handleAmarPayIpn(
  body: Record<string, string>
): Promise<WebhookHandleResult & { error?: string }> {
  return handleUnifiedWebhook({ body: body || {} });
}

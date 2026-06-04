import type { PaymentProviderCode } from "../providers/paymentProvider.config";
import {
  getActivePaymentProvider,
  isProviderConfigured,
} from "../providers/paymentProvider.config";
import type { PaymentProviderStrategy } from "./paymentProvider.interface";
import { amarpayStrategy } from "./strategies/amarpay.strategy";
import { bkashStrategy } from "./strategies/bkash.strategy";
import { nagadStrategy } from "./strategies/nagad.strategy";
import { sslCommerzStrategy } from "./strategies/sslcommerz.strategy";
import { epsStrategy } from "./strategies/eps.strategy";

const strategies: Record<PaymentProviderCode, PaymentProviderStrategy> = {
  bkash: bkashStrategy,
  nagad: nagadStrategy,
  sslcommerz: sslCommerzStrategy,
  amarpay: amarpayStrategy,
  eps: epsStrategy,
};

export function getPaymentStrategy(code: PaymentProviderCode): PaymentProviderStrategy {
  const strategy = strategies[code];
  if (!strategy) {
    throw new Error(`Unknown payment provider: ${code}`);
  }
  return strategy;
}

export function getActivePaymentStrategy(): PaymentProviderStrategy {
  return getPaymentStrategy(getActivePaymentProvider());
}

export function listPaymentStrategies(): PaymentProviderStrategy[] {
  return Object.values(strategies);
}

export function isActiveProviderReady(): boolean {
  const code = getActivePaymentProvider();
  return isProviderConfigured(code);
}

export { getActivePaymentProvider };

import { ExtraCurrency, SendMode } from "@ton/core";

export interface SendOptions {
  bounce?: boolean;
  sendMode?: SendMode;
  extraCurrencies?: ExtraCurrency;
}

// The ABI generator uses extraCurrencies; @ton/core's provider uses extracurrency.
export function providerOptions(options: SendOptions = {}) {
  return {
    bounce: options.bounce ?? false,
    sendMode: options.sendMode ?? SendMode.PAY_GAS_SEPARATELY,
    extracurrency: options.extraCurrencies,
  };
}

export function requireUnsharded(options?: { toShard?: unknown }): void {
  if (options?.toShard !== undefined) {
    throw new Error("toShard deployment is not supported by this SDK.");
  }
}

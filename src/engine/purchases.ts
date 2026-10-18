import type { CoinPack } from '../core/shop';

/** A purchase the store reports as paid. */
export interface StorePurchase {
  transactionId: string;
  productId: string;
  /** Units bought in this transaction (consumables can be bought several at once). */
  quantity: number;
}

/**
 * The coin store. `start` registers the handler that credits a paid purchase;
 * the store finishes (consumes) the purchase only after the handler resolved,
 * so a purchase interrupted by a crash is delivered again on the next launch.
 */
export interface PurchasePort {
  /** 'store' = App Store / Google Play; 'test' = no money, for the trial build only. */
  readonly kind: 'store' | 'test';
  start(onPaid: (p: StorePurchase) => Promise<void>): Promise<void>;
  /** Packs with the store's localised prices. */
  products(): CoinPack[];
  /** Opens the store's purchase sheet. Resolves false when the player cancelled. */
  buy(productId: string): Promise<boolean>;
}

/** Trial / dev builds only: purchases complete instantly and cost nothing. */
export function testPurchasePort(packs: readonly CoinPack[]): PurchasePort {
  let handler: ((p: StorePurchase) => Promise<void>) | null = null;
  let n = 0;
  return {
    kind: 'test',
    async start(onPaid) {
      handler = onPaid;
    },
    products: () => [...packs],
    async buy(productId) {
      if (!handler) throw new Error('ショップの準備ができていません');
      await handler({ transactionId: `test-${Date.now()}-${++n}`, productId, quantity: 1 });
      return true;
    },
  };
}

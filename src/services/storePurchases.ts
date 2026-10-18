import type { CoinPack } from '../core/shop';
import type { PurchasePort, StorePurchase } from '../engine/purchases';
import { isNativeApp } from './nativeNotifications';

/*
 * App Store / Google Play in-app purchases through cordova-plugin-purchase
 * (works inside the Capacitor app; the plugin defines the global CdvPurchase).
 * Coins are consumables: credited on "approved", then finished (consumed).
 * No server: the purchase is trusted as the store reports it.
 */

/* Minimal shapes of the plugin API used here (see node_modules/cordova-plugin-purchase/www/store.d.ts). */
interface CdvTransaction {
  transactionId: string;
  isConsumed?: boolean;
  quantity?: number;
  products: { id: string }[];
  finish(): Promise<void>;
}
interface CdvProduct {
  pricing?: { price: string };
  getOffer(): { order(): Promise<{ code: number; message: string } | undefined> } | undefined;
}
interface CdvStore {
  register(p: { id: string; type: string; platform: string }[]): void;
  when(): { approved(cb: (t: CdvTransaction) => void): unknown };
  initialize(platforms: string[]): Promise<unknown>;
  get(id: string, platform?: string): CdvProduct | undefined;
}
interface CdvGlobal {
  store: CdvStore;
  ProductType: { CONSUMABLE: string };
  Platform: { APPLE_APPSTORE: string; GOOGLE_PLAY: string };
  ErrorCode: { PAYMENT_CANCELLED: number };
}

function cdv(): CdvGlobal | undefined {
  return (globalThis as { CdvPurchase?: CdvGlobal }).CdvPurchase;
}

function deviceReady(): Promise<void> {
  if (cdv()) return Promise.resolve();
  return new Promise((resolve) => document.addEventListener('deviceready', () => resolve(), { once: true }));
}

/** The real coin store inside the iOS / Android app; null on the web. */
export function nativeStorePort(packs: readonly CoinPack[]): PurchasePort | null {
  if (!isNativeApp()) return null;
  const platformName = (globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
  let platform = '';
  return {
    kind: 'store',
    async start(onPaid: (p: StorePurchase) => Promise<void>) {
      await deviceReady();
      const C = cdv();
      if (!C) throw new Error('課金プラグインが見つかりません');
      platform = platformName === 'ios' ? C.Platform.APPLE_APPSTORE : C.Platform.GOOGLE_PLAY;
      C.store.register(packs.map((p) => ({ id: p.productId, type: C.ProductType.CONSUMABLE, platform })));
      C.store.when().approved((t) => {
        if (t.isConsumed) return void t.finish();
        void (async () => {
          for (const p of t.products) await onPaid({ transactionId: t.transactionId, productId: p.id, quantity: t.quantity ?? 1 });
          // finished only after the coins are saved; otherwise the store delivers it again next time
          await t.finish();
        })().catch(() => {
          /* left unfinished on purpose: re-delivered on the next launch */
        });
      });
      await C.store.initialize([platform]);
    },
    products() {
      const C = cdv();
      return packs.map((p) => ({ ...p, price: C?.store.get(p.productId, platform)?.pricing?.price ?? p.price }));
    },
    async buy(productId) {
      const C = cdv();
      const offer = C?.store.get(productId, platform)?.getOffer();
      if (!C || !offer) throw new Error('ストアに接続できません。時間をおいて試してください');
      const err = await offer.order();
      if (!err) return true;
      if (err.code === C.ErrorCode.PAYMENT_CANCELLED) return false;
      throw new Error(err.message || '購入できませんでした');
    },
  };
}

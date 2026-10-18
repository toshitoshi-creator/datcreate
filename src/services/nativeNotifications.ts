import type { NotificationPort } from '../engine/completionNotifier';

const NOTICE_ID = 7201;

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

/** True inside the iOS / Android app (the Capacitor shell), false on the web. */
export function isNativeApp(): boolean {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/**
 * Local notifications scheduled on the device: no server is involved, the OS
 * delivers them while the app is closed. Null on the web.
 */
export function nativeNotificationPort(): NotificationPort | null {
  if (!isNativeApp()) return null;
  const plugin = import('@capacitor/local-notifications').then((m) => m.LocalNotifications);
  return {
    async schedule(atMs, title, body) {
      const ln = await plugin;
      let perm = await ln.checkPermissions();
      if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale') perm = await ln.requestPermissions();
      if (perm.display !== 'granted') return;
      await ln.cancel({ notifications: [{ id: NOTICE_ID }] });
      await ln.schedule({ notifications: [{ id: NOTICE_ID, title, body, schedule: { at: new Date(atMs), allowWhileIdle: true } }] });
    },
    async cancel() {
      const ln = await plugin;
      await ln.cancel({ notifications: [{ id: NOTICE_ID }] });
    },
  };
}

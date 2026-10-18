import { completionNoticeAt } from '../core/notice';
import type { Settings } from '../core/types';
import type { Clock } from './clock';
import type { ControllerState } from './gameController';

/** Device notifications (the native app's local notifications). */
export interface NotificationPort {
  /** Replace the pending completion notice with one at `atMs` (real epoch time). */
  schedule(atMs: number, title: string, body: string): Promise<void>;
  cancel(): Promise<void>;
}

export const COMPLETION_TITLE = 'DOT LIFE';
export const COMPLETION_BODY = 'ドットが完成しました！ お礼のプレゼントが届いています 🎁';

interface Source {
  getState(): ControllerState;
  subscribe(fn: (s: ControllerState) => void): () => void;
}
interface SettingsSource {
  get(): Settings;
  subscribe(fn: (s: Settings) => void): () => void;
}

/**
 * Keeps one pending "finished!" notice on the device in step with the game:
 * scheduled for the completion time, moved when items bring growth forward,
 * and cancelled on completion, keep-growing, archive, reset or when the
 * player turns it off. The OS shows it even while the app is closed.
 */
export class CompletionNotifier {
  private last: number | null | undefined = undefined;
  private queue: Promise<void> = Promise.resolve();
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly source: Source,
    private readonly settings: SettingsSource,
    private readonly clock: Clock,
    private readonly port: NotificationPort,
    private readonly wallNow: () => number = Date.now,
  ) {
    this.offs.push(source.subscribe(() => this.sync()), settings.subscribe(() => this.sync()));
    this.sync();
  }

  /** The completion time to notify at (real epoch ms), or null for none. */
  desired(): number | null {
    const s = this.source.getState();
    if (!this.settings.get().notifyOnComplete || s.status !== 'ready') return null;
    const at = completionNoticeAt(s.game);
    const now = this.clock.now();
    if (at === null || at <= now) return null;
    // the game clock can differ from wall time (trial clock); the OS uses wall time
    return at - (now - this.wallNow());
  }

  sync(): Promise<void> {
    const at = this.desired();
    // small wall-clock drift of the computed time is not a change
    if (at === this.last || (at !== null && this.last != null && Math.abs(at - this.last) < 1000)) return this.queue;
    if (this.source.getState().status === 'loading') return this.queue;
    this.last = at;
    this.queue = this.queue
      .then(() => (at === null ? this.port.cancel() : this.port.schedule(at, COMPLETION_TITLE, COMPLETION_BODY)))
      .catch(() => {
        // notifications are a convenience; never let them break the game
        this.last = undefined;
      });
    return this.queue;
  }

  dispose() {
    for (const off of this.offs) off();
  }
}

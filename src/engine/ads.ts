/** Rewarded video ads (AdMob in the app). */
export interface AdPort {
  /** 'ads' = real ads; 'test' = a pretend ad, for the trial build only. */
  readonly kind: 'ads' | 'test';
  start(): Promise<void>;
  /** Shows one rewarded ad. Resolves true only if the player watched it to the reward. */
  showRewarded(): Promise<boolean>;
}

/** Trial / dev builds only: a pretend ad that "plays" for a moment and always rewards. */
export function testAdPort(playMs = 1500): AdPort {
  return {
    kind: 'test',
    async start() {},
    showRewarded: () => new Promise((r) => setTimeout(() => r(true), playMs)),
  };
}

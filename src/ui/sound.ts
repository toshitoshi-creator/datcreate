let ctx: AudioContext | null = null;

/** A short soft blip whose pitch follows the dot's hue. Created lazily. */
export function playBlip(hue: number) {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(330 + (hue / 360) * 550, t);
    osc.frequency.exponentialRampToValueAtTime(220 + (hue / 360) * 300, t + 0.25);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  } catch {
    /* audio is optional */
  }
}

export type LocationResult =
  | { status: 'ok'; lat: number; lon: number }
  | { status: 'denied' | 'unavailable' | 'timeout' };

/**
 * One-shot coarse position. Coordinates are rounded (~1 km) and only kept in
 * memory by the caller; they are never persisted or displayed.
 */
export function getCoarseLocation(geo: Geolocation | null | undefined, timeoutMs = 10_000): Promise<LocationResult> {
  if (!geo) return Promise.resolve({ status: 'unavailable' });
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: LocationResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => finish({ status: 'timeout' }), timeoutMs + 500);
    try {
      geo.getCurrentPosition(
        (pos) => finish({ status: 'ok', lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 }),
        (err) => finish({ status: err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable' }),
        { enableHighAccuracy: false, maximumAge: 30 * 60_000, timeout: timeoutMs },
      );
    } catch {
      finish({ status: 'unavailable' });
    }
  });
}

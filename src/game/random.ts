export function hash2d(seed: number, x: number, y: number) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function rand01(seed: number, x: number, y: number) {
  return hash2d(seed, x, y) / 0xffffffff;
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

export function valueNoise(seed: number, x: number, y: number, scale: number) {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);

  const a = rand01(seed, x0, y0);
  const b = rand01(seed, x1, y0);
  const c = rand01(seed, x0, y1);
  const d = rand01(seed, x1, y1);

  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

export function makeSequence(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0xffffffff;
  };
}

export function choose<T>(rng: () => number, list: T[]) {
  return list[Math.floor(rng() * list.length)]!;
}

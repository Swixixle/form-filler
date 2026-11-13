// Cutting a photo of a handwritten page into its lines, so a handwriting reader (which reads one line at a time) can
// read each, and so each line's own picture can be shown beside what was read. Plain pixel rules:
//
//   1. Black and white, the same way the blank finder does it (a shadow does not black out half the page).
//   2. The paper's own printed rules are taken out: a run of ink far longer than any written word (ruled lines, a
//      notebook's margin line) is not writing.
//   3. Rows that hold ink, grouped. A gap smaller than a quarter of a line (the dot of an i, a descender) does not end
//      a line; a group much taller than the others is two lines touching, split at its thinnest row.
//
// `gray` is one byte per pixel, 0 black to 255 white. Returns [{ x0, y0, x1, y1 }] top to bottom.
import { threshold } from './blanks.js';

export function segmentLines(gray, width, height) {
  const ink = threshold(gray, width, height), longH = Math.max(60, Math.round(width * 0.2)), longV = Math.max(60, Math.round(height * 0.25));
  const clear = (horizontal, long) => {
    const along = horizontal ? width : height, across = horizontal ? height : width, at = (a, b) => horizontal ? b * width + a : a * width + b;
    for (let b = 0; b < across; b++) {
      let start = -1, last = -1;
      for (let a = 0; a <= along; a++) {
        const on = a < along && ink[at(a, b)];
        if (on) { if (start < 0) start = a; last = a; continue; }
        if (start >= 0 && (a === along || a - last > 3)) { if (last - start + 1 >= long) for (let k = start; k <= last; k++) ink[at(k, b)] = 0; start = -1; }
      }
    }
  };
  // A photographed rule is often broken into dashes by grain, so its runs are short. A row (or column) that is mostly
  // ink from one side of the page to the other is a rule anyway; so are its blurred edges just beside it.
  const stripes = horizontal => {
    const along = horizontal ? width : height, across = horizontal ? height : width, at = (a, b) => horizontal ? b * width + a : a * width + b;
    const count = Array.from({ length: across }, (_, b) => { let dark = 0; for (let a = 0; a < along; a++) dark += ink[at(a, b)]; return dark; });
    count.forEach((dark, b) => {
      if (dark < along * 0.5) return;
      for (let near = Math.max(0, b - 2); near <= Math.min(across - 1, b + 2); near++) if (near === b || count[near] > along * 0.15) for (let a = 0; a < along; a++) ink[at(a, near)] = 0;
    });
  };
  // Stripes first: taking out the long runs first would leave too little of a broken rule to count as one.
  stripes(true); stripes(false); clear(true, longH); clear(false, longV);
  // What a ruled line leaves behind (its antialiased edge, a row or two above and below) is a thin sliver: kept out by
  // asking for a little more than a speck of ink per row.
  const profile = new Float64Array(height), xs = [];
  for (let y = 0; y < height; y++) { let count = 0; for (let x = 0; x < width; x++) count += ink[y * width + x]; profile[y] = count; }
  const smooth = Float64Array.from(profile, (_, y) => (profile[Math.max(0, y - 1)] + profile[y] + profile[Math.min(height - 1, y + 1)]) / 3);
  const floor = Math.max(2, width * 0.002);
  let bands = [];
  for (let y = 0, start = -1; y <= height; y++) {
    const on = y < height && smooth[y] > floor;
    if (on && start < 0) start = y;
    if (!on && start >= 0) { bands.push({ y0: start, y1: y - 1 }); start = -1; }
  }
  const median = list => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };
  let typical = median(bands.map(band => band.y1 - band.y0 + 1).filter(size => size >= 6));
  // Join a band to the one before it across a small gap.
  bands = bands.reduce((out, band) => { const prior = out[out.length - 1]; if (prior && band.y0 - prior.y1 < Math.max(3, typical * 0.25)) prior.y1 = band.y1; else out.push({ ...band }); return out; }, []);
  typical = median(bands.map(band => band.y1 - band.y0 + 1).filter(size => size >= 6));
  // Split a band that is two lines touching, at its thinnest row in the middle half.
  const split = [];
  for (const band of bands) {
    const size = band.y1 - band.y0 + 1;
    if (typical && size > typical * 1.8) {
      let best = -1, low = Infinity;
      for (let y = band.y0 + Math.round(size * 0.25); y <= band.y1 - Math.round(size * 0.25); y++) if (smooth[y] < low) { low = smooth[y]; best = y; }
      if (best > 0) { split.push({ y0: band.y0, y1: best }, { y0: best + 1, y1: band.y1 }); continue; }
    }
    split.push(band);
  }
  for (const band of split) {
    // Where the writing starts and ends: columns with a stroke in them, not a stray speck of the photo's grain.
    const columns = new Uint16Array(width);
    let dark = 0;
    for (let y = band.y0; y <= band.y1; y++) for (let x = 0; x < width; x++) if (ink[y * width + x]) { dark++; columns[x]++; }
    let left = width, right = -1;
    for (let x = 0; x < width; x++) { let near = 0; for (let k = Math.max(0, x - 2); k <= Math.min(width - 1, x + 2); k++) near += columns[k]; if (near >= 6 && columns[x]) { if (x < left) left = x; right = x; } }
    // A band that is a few specks, or too thin to be letters, is not a line of writing.
    if (right < 0 || band.y1 - band.y0 + 1 < Math.max(6, typical * 0.3) || dark < (band.y1 - band.y0 + 1) * 3) continue;
    const pad = Math.max(4, Math.round((band.y1 - band.y0) * 0.2));
    xs.push({ x0: Math.max(0, left - pad), y0: Math.max(0, band.y0 - pad), x1: Math.min(width, right + pad + 1), y1: Math.min(height, band.y1 + pad + 1) });
  }
  return xs;
}

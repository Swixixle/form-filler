// Finding the blanks on a form, from its pixels alone. No model and no guessing at meaning: a blank is an empty place
// a person is meant to write in, and on paper forms those have three shapes.
//
//   1. A line to write on: a long, thin, straight horizontal line with empty space above it.
//   2. A box, or a cell of a table: a rectangle that is empty, or empty to the right of (or below) a short label.
//   3. A checkbox: a small closed square, corners and all (the ring of a letter is not one).
//
// The page is first made black and white. Lines are runs of dark pixels long enough that text cannot make them (letters
// have gaps); a little gap is allowed so a scanned or photographed line still counts. Rectangles are pairs of matching
// horizontal lines joined by vertical ones. Everything is returned in reading order, top to bottom, then left to right.
//
// `gray` is one byte per pixel, 0 black to 255 white, `width` by `height`.

export function threshold(gray, width, height) {
  // Each pixel against the mean of its neighbourhood (an integral image), so a shadow across a phone photo of a form
  // does not turn half the page black.
  const sums = new Float64Array((width + 1) * (height + 1)), ink = new Uint8Array(width * height), r = Math.max(8, Math.round(Math.min(width, height) / 40));
  for (let y = 0; y < height; y++) { let row = 0; for (let x = 0; x < width; x++) { row += gray[y * width + x]; sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1] + row; } }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(width, x + r + 1), y1 = Math.min(height, y + r + 1);
    const mean = (sums[y1 * (width + 1) + x1] - sums[y0 * (width + 1) + x1] - sums[y1 * (width + 1) + x0] + sums[y0 * (width + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    const value = gray[y * width + x];
    ink[y * width + x] = value < mean - 18 && value < 200 ? 1 : 0;
  }
  return ink;
}

// Runs of ink along each row (or column), allowing small gaps, at least `min` long. Merged across neighbouring rows
// into lines with a thickness. Returns [{ a0, a1, b0, b1 }]: a is along the line, b across it.
function runs(ink, width, height, horizontal, min, gap = 3) {
  const along = horizontal ? width : height, across = horizontal ? height : width, found = [];
  const at = (a, b) => horizontal ? ink[b * width + a] : ink[a * width + b];
  for (let b = 0; b < across; b++) {
    let start = -1, last = -1, dark = 0;
    for (let a = 0; a <= along; a++) {
      const on = a < along && at(a, b);
      if (on) { if (start < 0) { start = a; dark = 0; } last = a; dark++; continue; }
      if (start >= 0 && (a === along || a - last > gap)) {
        if (last - start + 1 >= min && dark / (last - start + 1) > 0.85) found.push({ a0: start, a1: last, b });
        start = -1;
      }
    }
  }
  // Merge: a run joins a line when it is in the next row (or within 2) and overlaps it along most of its length.
  const lines = [];
  for (const run of found) {
    const line = lines.find(item => run.b - item.b1 <= 2 && run.b >= item.b0 && Math.min(run.a1, item.a1) - Math.max(run.a0, item.a0) > 0.8 * Math.min(run.a1 - run.a0, item.a1 - item.a0));
    if (line) { line.b1 = run.b; line.a0 = Math.min(line.a0, run.a0); line.a1 = Math.max(line.a1, run.a1); } else lines.push({ a0: run.a0, a1: run.a1, b0: run.b, b1: run.b });
  }
  return lines.filter(line => line.b1 - line.b0 <= 6);       // a thick bar is shading, not a line to write on
}
// A line a scan or photo broke into pieces is one line again: same position across it, a short gap along it.
function joinBroken(lines, gap) {
  const sorted = [...lines].sort((a, b) => a.a0 - b.a0), out = [];
  for (const line of sorted) {
    const prior = out.find(item => Math.abs((item.b0 + item.b1) / 2 - (line.b0 + line.b1) / 2) <= 3 && line.a0 - item.a1 <= gap && line.a0 >= item.a0);
    if (prior) { prior.a1 = Math.max(prior.a1, line.a1); prior.b0 = Math.min(prior.b0, line.b0); prior.b1 = Math.max(prior.b1, line.b1); } else out.push({ ...line });
  }
  return out;
}

const inkIn = (ink, width, x0, y0, x1, y1) => {
  let dark = 0, all = 0;
  for (let y = Math.max(0, Math.round(y0)); y < Math.round(y1); y++) for (let x = Math.max(0, Math.round(x0)); x < Math.round(x1); x++) { all++; dark += ink[y * width + x]; }
  return all ? dark / all : 0;
};
// The ink inside a region, as the columns and rows that hold any, so a label can be found and stepped past.
function inkExtent(ink, width, x0, y0, x1, y1) {
  let left = Infinity, right = -1, top = Infinity, bottom = -1;
  for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) if (ink[y * width + x]) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  return right < 0 ? null : { left, right, top, bottom };
}

// A checkbox is a square, so it has corners. In small print the ring of a letter (an O, the Q of "Qty") is drawn
// with a flat top, a flat bottom and upright sides, and by its sides alone it passes for a box; but there is no ink in
// its corners. Returns how many of the outline's four corners hold ink. `top` and `bottom` are the two lines.
function corners(ink, width, height, top, bottom) {
  const side = top.x1 - top.x0, reach = Math.max(2, Math.round(side * 0.25)), size = Math.max(2, Math.round(side * 0.12));
  const dark = (x, y) => x >= 0 && y >= 0 && x < width && y < height && ink[y * width + x] === 1;
  // The outer edge of a wall on one row: the ink nearest the end of the top line, followed outward as far as it goes.
  const outer = (y, from, step) => {
    let x = null;
    for (let k = 0; k <= reach && x === null; k++) x = dark(from - step * k, y) ? from - step * k : dark(from + step * k, y) ? from + step * k : null;
    if (x === null) return from;
    for (let k = 0; k < reach && dark(x + step, y); k++) x += step;
    return x;
  };
  const middle = list => list.sort((a, b) => a - b)[Math.floor(list.length / 2)], rows = [];
  for (let y = top.y1 + Math.round((bottom.y0 - top.y1) * 0.3); y <= top.y1 + Math.round((bottom.y0 - top.y1) * 0.7); y++) rows.push(y);
  const left = middle(rows.map(y => outer(y, top.x0, -1))), right = middle(rows.map(y => outer(y, top.x1, 1)));
  const inked = (x0, y0) => { let count = 0; for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) if (dark(x, y)) count++; return count * 2 >= size * size; };
  return [inked(left, top.y0), inked(right - size + 1, top.y0), inked(left, bottom.y1 - size + 1), inked(right - size + 1, bottom.y1 - size + 1)].filter(Boolean).length;
}
// A rule to write on is ink nearly all the way along, with nothing hanging from it. The tops of a row of heavy letters
// (a bold heading) can line up into something as long and as straight, but there are gaps between the letters, and the
// letters themselves hang underneath.
function ruled(ink, width, height, line) {
  const dark = (x, y) => y >= 0 && y < height && ink[y * width + x] === 1, span = line.x1 - line.x0 + 1;
  let covered = 0, hanging = 0;
  for (let x = line.x0; x <= line.x1; x++) {
    let on = false;
    for (let y = line.y0 - 1; y <= line.y1 + 1 && !on; y++) on = dark(x, y);
    if (on) covered++;
    for (let y = line.y1 + 2; y < line.y1 + 6; y++) if (dark(x, y)) hanging++;
  }
  return covered >= span * 0.9 && hanging <= span * 4 * 0.25;
}

// The angle a page is turned by, in degrees: the one at which rows of ink line up best (a photo taken a little crooked).
export function skewOf(gray, width, height) {
  const ink = threshold(gray, width, height), points = [];
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) if (ink[y * width + x]) points.push(x, y);
  let best = 0, bestScore = -1;
  for (let degrees = -5; degrees <= 5.001; degrees += 0.2) {
    const slope = Math.tan(degrees * Math.PI / 180), bins = new Float64Array(height * 2 + 2);
    for (let index = 0; index < points.length; index += 2) { const row = Math.round(points[index + 1] - points[index] * slope) + height; if (row >= 0 && row < bins.length) bins[row]++; }
    let score = 0; for (const count of bins) score += count * count;
    if (score > bestScore) { bestScore = score; best = degrees; }
  }
  return Math.round(best * 10) / 10;
}
// The page turned back by `degrees` around its centre, white where nothing was.
export function rotate(gray, width, height, degrees) {
  if (!degrees) return gray;
  const out = new Uint8Array(width * height).fill(255), angle = degrees * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle), cx = width / 2, cy = height / 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.round(cos * (x - cx) - sin * (y - cy) + cx), sy = Math.round(sin * (x - cx) + cos * (y - cy) + cy);
    if (sx >= 0 && sx < width && sy >= 0 && sy < height) out[y * width + x] = gray[sy * width + sx];
  }
  return out;
}

export function findBlanks(gray, width, height, { textHeight, debug } = {}) {
  const ink = threshold(gray, width, height);
  const unit = textHeight || Math.max(10, Math.round(height / 45));        // about one line of the form's own text
  const minLine = Math.max(Math.round(unit * 2.5), Math.round(width * 0.04));
  const hLines = joinBroken(runs(ink, width, height, true, Math.round(unit * 0.6)), Math.round(unit * 0.4)).filter(line => line.a1 - line.a0 >= minLine).map(line => ({ x0: line.a0, x1: line.a1, y0: line.b0, y1: line.b1 }));
  const vLines = joinBroken(runs(ink, width, height, false, Math.max(10, Math.round(unit * 0.35))), Math.round(unit * 0.4)).map(line => ({ y0: line.a0, y1: line.a1, x0: line.b0, x1: line.b1 }));
  const hShort = runs(ink, width, height, true, Math.max(10, Math.round(unit * 0.35))).map(line => ({ x0: line.a0, x1: line.a1, y0: line.b0, y1: line.b1 })).filter(line => line.x1 - line.x0 <= unit * 2.2);
  const tol = Math.max(4, Math.round(unit * 0.4));
  const vAt = (x, top, bottom) => vLines.filter(line => Math.abs((line.x0 + line.x1) / 2 - x) <= tol && line.y0 <= top + tol && line.y1 >= bottom - tol);
  const blanks = [], used = new Set();

  // Rectangles: a top and a bottom line joined at both ends. Split at any vertical line that crosses the whole height.
  const byY = [...hLines].sort((a, b) => a.y0 - b.y0);
  for (const top of byY) for (const bottom of byY) {
    if (bottom.y0 <= top.y1 + unit * 0.6 || bottom.y0 - top.y1 > unit * 8) continue;
    const x0 = Math.max(top.x0, bottom.x0), x1 = Math.min(top.x1, bottom.x1);
    if (x1 - x0 < unit) continue;
    const walls = vLines.filter(line => line.y0 <= top.y1 + tol && line.y1 >= bottom.y0 - tol && (line.x0 + line.x1) / 2 >= x0 - tol && (line.x0 + line.x1) / 2 <= x1 + tol)
      .map(line => (line.x0 + line.x1) / 2).sort((a, b) => a - b);
    if (walls.length < 2) continue;
    // Only the nearest bottom for each stretch of top: a taller rectangle made of two stacked cells is not a cell.
    for (let index = 0; index + 1 < walls.length; index++) {
      const left = walls[index], right = walls[index + 1];
      if (right - left < unit * 0.7) continue;
      const key = Math.round(left) + ':' + Math.round(top.y0);
      if (used.has(key)) continue;
      used.add(key);
      const inset = Math.max(4, Math.round(unit * 0.15)), cell = { x0: left + inset, y0: top.y1 + inset, x1: right - inset, y1: bottom.y0 - inset };
      const w = cell.x1 - cell.x0, h = cell.y1 - cell.y0;
      // A few specks (a scan, a photo's grain) are not a label: less ink than a small letter, and the cell is empty.
      const filled = inkIn(ink, width, cell.x0, cell.y0, cell.x1, cell.y1) * (cell.x1 - cell.x0) * (cell.y1 - cell.y0) < unit * unit * 0.12 ? null : inkExtent(ink, width, cell.x0, cell.y0, cell.x1, cell.y1);
      if (!filled) { blanks.push({ kind: 'box', ...cell }); continue; }
      // A label in the cell: the blank is what is left to its right, or below a caption along its top.
      // A tall box with its caption along the top is written in below the caption; a one-line cell, to the right.
      if (h > unit * 2.2 && cell.y1 - filled.bottom > Math.max(unit * 1.1, h * 0.45)) blanks.push({ kind: 'box', ...cell, y0: filled.bottom + 3, label: true });
      else if (cell.x1 - filled.right > Math.max(unit * 3, w * 0.25)) blanks.push({ kind: 'box', ...cell, x0: filled.right + unit * 0.5, label: true });
    }
  }
  if (debug) debug({ hShort, vLines, unit, tol });
  // Checkboxes: a small square, its four sides found, its corners inked, nothing inside. The top and bottom must end
  // at the same places, to within a fifth of the side (a box that small is not found by the page-wide allowance).
  for (const top of hShort) for (const bottom of hShort) {
    const side = top.x1 - top.x0, gap = bottom.y0 - top.y1, ends = Math.max(4, Math.round(side * 0.2));
    if (gap < side * 0.6 || gap > side * 1.4 || Math.abs(bottom.x0 - top.x0) > ends || Math.abs(bottom.x1 - top.x1) > ends) continue;
    if (!vAt(top.x0, top.y0, bottom.y1).length || !vAt(top.x1, top.y0, bottom.y1).length) continue;
    if (corners(ink, width, height, top, bottom) < 3) continue;        // the ring of a letter
    const inset = Math.max(3, Math.round(side * 0.18)), cell = { x0: top.x0 + inset, y0: top.y1 + 2, x1: top.x1 - inset, y1: bottom.y0 - 2 };
    if (inkIn(ink, width, cell.x0, cell.y0, cell.x1, cell.y1) < 0.05 && !blanks.some(blank => blank.kind === 'check' && Math.abs(blank.x0 - cell.x0) < tol && Math.abs(blank.y0 - cell.y0) < tol)) blanks.push({ kind: 'check', ...cell });
  }
  const inside = (line, box) => (line.x0 + line.x1) / 2 >= box.x0 - tol && (line.x0 + line.x1) / 2 <= box.x1 + tol && line.y0 >= box.y0 - tol * 2 && line.y0 <= box.y1 + tol * 2;
  const boxes = blanks.filter(blank => blank.kind !== 'check');
  // Lines to write on: the space above a line, one text line high, if it is empty and not part of a box.
  for (const line of hLines) {
    // A box's own edge: walls at both ends, going up from it or down from it.
    if ((vAt(line.x0, line.y0 - unit, line.y0).length && vAt(line.x1, line.y0 - unit, line.y0).length) || (vAt(line.x0, line.y1, line.y1 + unit).length && vAt(line.x1, line.y1, line.y1 + unit).length)) continue;
    if (boxes.some(box => inside(line, box) || (Math.abs(line.y0 - box.y1) <= tol * 2 && line.x0 < box.x1 && line.x1 > box.x0) || (Math.abs(line.y1 - box.y0) <= tol * 2 && line.x0 < box.x1 && line.x1 > box.x0))) continue;
    const area = { x0: line.x0, y0: line.y0 - unit * 1.5, x1: line.x1, y1: line.y0 - 2 };
    if (area.y0 < 0) continue;
    if (inkIn(ink, width, area.x0, area.y0, area.x1, area.y1) > 0.02) continue;      // an underlined heading, or a line already written on
    if (!ruled(ink, width, height, line)) continue;                                     // the tops of a row of bold letters
    blanks.push({ kind: 'line', ...area });
  }
  // A row of labelled cells over a row of empty ones is a table's header: those labels are not blanks.
  const header = blank => blank.label && blank.kind === 'box' && blanks.some(other => other !== blank && other.kind === 'box' && !other.label && Math.abs(other.y0 - blank.y1) <= unit * 0.8 && other.x0 <= blank.x0 + unit && other.x1 >= blank.x1 - tol);
  return order(blanks.filter(blank => !header(blank)), unit);
}

// Round option buttons drawn on a page ("( ) Yes   ( ) No"), where only one of a set may be chosen. A button is a ring
// of ink: round, hollow, thin, a piece of ink by itself. Three things keep letters out, because a capital O is a ring
// too: a button is at least about a third of a line high (the "o" of small print and of bullets is smaller), it stands
// apart from what is beside it (a letter has its neighbours close by), and it never comes alone: there is another the
// same size on its line, or straight above or below. Each such set comes back as one blank, kind 'choice', with a
// `spots` entry for every button, so that choosing one un-chooses the others. A lone ring is left alone.
export function findOptions(gray, width, height, { textHeight, ink: given } = {}) {
  const ink = given || threshold(gray, width, height), unit = textHeight || Math.max(10, Math.round(height / 45));
  const least = Math.max(12, Math.round(unit * 0.36)), most = Math.round(unit * 1.3), dark = (x, y) => x >= 0 && y >= 0 && x < width && y < height && ink[y * width + x] === 1;
  // Each piece of ink (pixels that touch, corners included), followed with a stack. Pieces bigger than a button are
  // walked to the end, so they are not started again, but not kept.
  const seen = new Uint8Array(width * height), stack = new Int32Array(width * height), rings = [];
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || seen[start]) continue;
    let top = 0, x0 = width, x1 = -1, y0 = height, y1 = -1, kept = [];
    stack[top++] = start; seen[start] = 1;
    while (top) {
      const at = stack[--top], x = at % width, y = (at - x) / width;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (kept && (x1 - x0 > most || y1 - y0 > most)) kept = null; else if (kept) kept.push(at);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && ink[next] && !seen[next]) { seen[next] = 1; stack[top++] = next; }
      }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (!kept || w < least || h < least || Math.abs(w - h) > Math.max(2, Math.max(w, h) * 0.15)) continue;
    // A ring: its ink lies on a circle about its middle, all the way round, with nothing nearer the middle.
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, radius = (w + h) / 4, sectors = new Uint8Array(24);
    let stray = 0, inner = 0;
    for (const at of kept) {
      const x = at % width, y = (at - x) / width, far = Math.hypot(x - cx, y - cy);
      if (far > radius + 1.5) stray++; else if (far < radius * 0.5) inner++; else sectors[Math.floor((Math.atan2(y - cy, x - cx) + Math.PI) / (2 * Math.PI) * 24) % 24] = 1;
    }
    const thick = kept.length / (2 * Math.PI * radius * 0.9);
    if (inner || stray > kept.length * 0.02 || sectors.reduce((sum, on) => sum + on, 0) < 23 || thick > radius * 0.34) continue;
    // Hollow: nothing else inside it either (a button already chosen has a dot, and is not a blank).
    let filled = 0;
    for (let y = Math.ceil(cy - radius * 0.45); y <= cy + radius * 0.45; y++) for (let x = Math.ceil(cx - radius * 0.45); x <= cx + radius * 0.45; x++) if (dark(x, y)) filled++;
    if (filled) continue;
    // Apart: clear paper beside it, a third of its width on each side, across the middle of its height.
    const gap = Math.max(3, Math.round(w * 0.3));
    let crowded = false;
    for (let y = Math.round(cy - h * 0.3); y <= cy + h * 0.3 && !crowded; y++) for (let k = 1; k <= gap && !crowded; k++) crowded = dark(x0 - k, y) || dark(x1 + k, y);
    if (!crowded) rings.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, cx, cy, size: (w + h) / 2 });
  }
  // Sets: rings of one size on one line, or one under another. A line that holds two questions is cut where the space
  // between two buttons is much wider than the narrowest space on that line.
  const alike = (a, b) => Math.abs(a.size - b.size) <= Math.max(2, Math.max(a.size, b.size) * 0.18), sets = [], used = new Set();
  const chain = (list, along, across, reach) => {
    const lines = [];
    for (const ring of [...list].sort((a, b) => a[across] - b[across])) { const line = lines.find(item => Math.abs(item[0][across] - ring[across]) <= ring.size * 0.35 && alike(item[0], ring)); if (line) line.push(ring); else lines.push([ring]); }
    for (const line of lines) {
      line.sort((a, b) => a[along] - b[along]);
      const gaps = line.slice(1).map((ring, index) => ring[along] - line[index][along]), narrow = Math.min(...gaps);
      let set = [line[0]];
      line.slice(1).forEach((ring, index) => { if (gaps[index] > narrow * 1.8 || gaps[index] > reach(ring)) { if (set.length > 1) sets.push(set); set = []; } set.push(ring); });
      if (set.length > 1) sets.push(set);
    }
  };
  chain(rings, 'cx', 'cy', () => Infinity);
  for (const set of sets) for (const ring of set) used.add(ring);
  chain(rings.filter(ring => !used.has(ring)), 'cy', 'cx', ring => ring.size * 3.5);
  const box = ring => ({ x0: ring.x0, y0: ring.y0, x1: ring.x1, y1: ring.y1 });
  return order(sets.map(set => ({ kind: 'choice', choice: 'radio', x0: Math.min(...set.map(ring => ring.x0)), y0: Math.min(...set.map(ring => ring.y0)), x1: Math.max(...set.map(ring => ring.x1)), y1: Math.max(...set.map(ring => ring.y1)), spots: set.map(box) })), unit);
}
// What each button of a set is called: the words printed just after it, as far as the next button or a wide space.
// `words` are the text reader's [{ text, bbox }]. A button with no words after it is called by its number.
export function nameOptions(set, words, unit = 20) {
  const spots = set.spots.map((spot, index) => {
    const tall = spot.y1 - spot.y0, onLine = word => Math.min(word.bbox.y1, spot.y1 + tall * 0.3) - Math.max(word.bbox.y0, spot.y0 - tall * 0.3) >= 0.4 * (word.bbox.y1 - word.bbox.y0);
    const stop = Math.min(Infinity, ...set.spots.filter(other => other !== spot && other.x0 > spot.x1 && other.y0 < spot.y1 && other.y1 > spot.y0).map(other => other.x0));
    const phrase = [];
    for (const word of words.filter(word => onLine(word) && word.bbox.x0 >= spot.x1 - 2 && word.bbox.x1 <= stop + 2).sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
      if (word.bbox.x0 - (phrase.length ? phrase[phrase.length - 1].bbox.x1 : spot.x1) > unit * (phrase.length ? 0.9 : 1.5) || phrase.length === 4) break;
      phrase.push(word);
    }
    return { ...spot, option: phrase.map(word => word.text).join(' ').replace(/[,;:.]+$/, '') || String(index + 1) };
  });
  spots.forEach((spot, index) => { if (spots.findIndex(other => other.option === spot.option) !== index) spot.option += ' (' + (index + 1) + ')'; });
  return { ...set, spots, options: spots.map(spot => spot.option) };
}

// Reading order: rows first (a blank belongs to a row if its middle is within half a line of the row's), then left to right.
export function order(blanks, unit = 20) {
  const sorted = [...blanks].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2), rows = [];
  for (const blank of sorted) {
    const middle = (blank.y0 + blank.y1) / 2, row = rows.find(item => Math.abs(item.middle - middle) <= unit * 0.6);
    if (row) row.items.push(blank); else rows.push({ middle, items: [blank] });
  }
  return rows.flatMap(row => row.items.sort((a, b) => a.x0 - b.x0)).map(blank => ({ ...blank, x0: Math.round(blank.x0), y0: Math.round(blank.y0), x1: Math.round(blank.x1), y1: Math.round(blank.y1) }));
}

// The words just left of a blank on its row, or just above it: what the form calls that blank. `words` are the text
// reader's [{ text, bbox }]. Shown so the person knows which answer is which; never used to decide anything.
export function labelFor(blank, words, unit = 20) {
  // On the blank's row: the word's height lies mostly within the blank's.
  const onRow = word => Math.min(word.bbox.y1, blank.y1 + 4) - Math.max(word.bbox.y0, blank.y0) >= 0.4 * (word.bbox.y1 - word.bbox.y0);
  const left = words.filter(word => word.bbox.x1 <= blank.x0 + 4 && onRow(word) && blank.x0 - word.bbox.x1 < unit * 12)
    .sort((a, b) => b.bbox.x1 - a.bbox.x1);
  const phrase = [];
  for (const word of left) { if (phrase.length && phrase[0].bbox.x0 - word.bbox.x1 > unit * 1.2) break; phrase.unshift(word); if (phrase.length === 5) break; }
  if (phrase.length) return phrase.map(word => word.text).join(' ').replace(/[:_]+$/, '');
  const above = words.filter(word => word.bbox.y1 <= blank.y0 + 4 && blank.y0 - word.bbox.y1 < unit * 1.5 && word.bbox.x0 < blank.x1 && word.bbox.x1 > blank.x0).sort((a, b) => a.bbox.x0 - b.bbox.x0);
  return above.slice(0, 5).map(word => word.text).join(' ').replace(/[:_]+$/, '');
}

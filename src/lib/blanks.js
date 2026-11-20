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
  const blanks = [], used = new Set(), spans = [], pieceOf = new Map();
  const dark = (x, y) => x >= 0 && y >= 0 && x < width && y < height && ink[y * width + x] === 1;

  // A wall, or the upright stroke of a letter? In a tight row a letter's stroke is nearly as tall as the row, so by its
  // length (with the allowance kept for broken walls) it passes for a wall, and the row is cut at it. The cuts stay as
  // they were: a stroke can seldom be told from a wall for sure, and where it cannot, nothing may change. What changes is
  // what is offered beside a stroke that is surely a letter (see the pieces below). That is a stroke that
  //   - stops short of both lines by more than 3 px, the gap the line finder bridges within a rule: a wall that stops
  //     that close to a rule, or that a scan broke that little, is as joined to it as a rule is to itself; and
  //   - stands among other ink: on two or more of its rows, ink within 9 px of it, its own letter's bowl, arm or serif
  //     or the next letter of its word. At the page's working width (1700 px, about 2.8 px to the point) 9 px is about
  //     3 pt: letters of a word stand closer than that in all but the largest bold print, and a wall stands further
  //     than that from the words of its cells. Two rows, so that a speck is not a neighbour.
  const inColumns = (stroke, y) => { for (let x = stroke.x0 - 1; x <= stroke.x1 + 1; x++) if (dark(x, y)) return true; return false; };
  // The paper between a line and one end of a stroke, in rows, looked at in the stroke's columns and one more each side
  // (the step that straightening a photo puts in a wall). From where its ink begins, the ink is followed back toward
  // the line through touching ink, no further to the side than it has rows to climb (a quarter circle reaches as far
  // to the side as it climbs) and 3 px: round a rounded corner a wall reaches its rule, while a letter's ink ends in
  // paper.
  const paper = (stroke, top, bottom, fromTop) => {
    const step = fromTop ? 1 : -1, first = fromTop ? top.y1 + 1 : bottom.y0 - 1, stop = fromTop ? bottom.y0 : top.y1;
    let gap = 0;
    for (let y = first; y !== stop && !inColumns(stroke, y); y += step) gap++;
    if (!gap || first + step * gap === stop) return gap;
    const lo = stroke.x0 - 1 - gap - 3, hi = stroke.x1 + 1 + gap + 3;
    let y = first + step * gap, row = [];
    for (let x = stroke.x0 - 1; x <= stroke.x1 + 1; x++) if (dark(x, y)) row.push(x);
    while (y !== first) {
      y -= step;
      const next = new Set();
      for (const x of row) for (let dx = -1; dx <= 1; dx++) if (x + dx >= lo && x + dx <= hi && dark(x + dx, y)) next.add(x + dx);
      if (!next.size) return Math.abs(y - first) + 1;
      for (const x of [...next]) {
        for (let k = x - 1; k >= lo && dark(k, y) && !next.has(k); k--) next.add(k);
        for (let k = x + 1; k <= hi && dark(k, y) && !next.has(k); k++) next.add(k);
      }
      row = [...next];
    }
    return 0;
  };
  const letter = (stroke, top, bottom) => {
    if (paper(stroke, top, bottom, true) <= 3 || paper(stroke, top, bottom, false) <= 3) return false;
    let rows = 0;
    for (let y = top.y1 + 1; y < bottom.y0 && rows < 2; y++) {
      if (!inColumns(stroke, y)) continue;
      let on = false;
      for (let k = 2; k <= 9 && !on; k++) on = dark(stroke.x0 - k, y) || dark(stroke.x1 + k, y);
      if (on) rows++;
    }
    return rows >= 2;
  };
  // The words a piece of a cell begins (or ends) with at a letter's stroke: the ink followed from the stroke along the
  // cell's rows, over gaps narrower than half a line (a word space is, even in typewriter print), as far as the piece
  // goes. A column with a single pixel of ink is paper (a photo's grain leaves single specks; a letter crosses a
  // column with more). Returns the words' last column.
  const wordFrom = (from, to, y0, y1) => {
    const step = to > from ? 1 : -1, gap = Math.round(unit * 0.5);
    let last = from;
    for (let x = from; step > 0 ? x <= to : x >= to; x += step) {
      let count = 0;
      for (let y = Math.round(y0); y < Math.round(y1) && count < 2; y++) if (dark(x, y)) count++;
      if (count >= 2) last = x; else if (Math.abs(x - last) > gap) break;
    }
    return last;
  };

  // Rectangles: a top and a bottom line joined at both ends. Split at any vertical line that crosses the whole height.
  const byY = [...hLines].sort((a, b) => a.y0 - b.y0);
  for (const top of byY) for (const bottom of byY) {
    if (bottom.y0 <= top.y1 + unit * 0.6 || bottom.y0 - top.y1 > unit * 8) continue;
    const x0 = Math.max(top.x0, bottom.x0), x1 = Math.min(top.x1, bottom.x1);
    if (x1 - x0 < unit) continue;
    const upright = vLines.filter(line => line.y0 <= top.y1 + tol && line.y1 >= bottom.y0 - tol && (line.x0 + line.x1) / 2 >= x0 - tol && (line.x0 + line.x1) / 2 <= x1 + tol)
      .map(line => ({ line, x: (line.x0 + line.x1) / 2 })).sort((a, b) => a.x - b.x);
    const walls = upright.map(item => item.x), sure = [];
    const isLetter = k => sure[k] === undefined ? (sure[k] = letter(upright[k].line, top, bottom)) : sure[k];
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
      const span = { top, bottom, left, right, cell, leftLetter: isLetter(index), rightLetter: isLetter(index + 1), sides: [upright[index].line, upright[index + 1].line], empty: false };
      spans.push(span);
      let blank = null;
      // A few specks (a scan, a photo's grain) are not a label: less ink than a small letter, and the cell is empty.
      const filled = inkIn(ink, width, cell.x0, cell.y0, cell.x1, cell.y1) * (cell.x1 - cell.x0) * (cell.y1 - cell.y0) < unit * unit * 0.12 ? null : inkExtent(ink, width, cell.x0, cell.y0, cell.x1, cell.y1);
      if (!filled) { blank = { kind: 'box', ...cell }; span.empty = true; }
      // A label in the cell: the blank is what is left to its right, or below a caption along its top.
      // A tall box with its caption along the top is written in below the caption; a one-line cell, to the right.
      else if (h > unit * 2.2 && cell.y1 - filled.bottom > Math.max(unit * 1.1, h * 0.45)) blank = { kind: 'box', ...cell, y0: filled.bottom + 3, label: true };
      else if (cell.x1 - filled.right > Math.max(unit * 3, w * 0.25)) blank = { kind: 'box', ...cell, x0: filled.right + unit * 0.5, label: true };
      if (blank) { blanks.push(blank); pieceOf.set(blank, span); }
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
  // A piece of a cell cut at a stroke that is surely a letter is what it was, but for these:
  //   - In a table's first row (no cell above it), a piece between a wall and the words, over a cell that is empty
  //     from wall to wall in the same column (its walls run on up through the piece's row, as a table's walls do): it
  //     is a header's, as a labelled cell over an empty one is above, and not a blank.
  //   - A piece left with less room than the narrowest blank a cell gives (0.7 of a line between walls, less the two
  //     insets) once the words beside its letters are stepped past, or, between two words, with less paper than the
  //     narrowest cell itself (0.7 of a line): it lies among the letters (between two of them, across a word space, or
  //     the bit of a letter beside a wall), and is not a blank.
  //   - A piece that begins at a letter is the room right of the words, a label's blank, and starts past the words'
  //     last ink; left narrower than the narrowest blank, it is none.
  //   - A piece written in below a caption stays as it was.
  // A line within 3 px of another is the same line here (the line finder's own allowance for one line in pieces).
  const firstRow = span => !spans.some(other => Math.abs(other.bottom.y0 - span.top.y0) <= 3 && other.left < span.right && other.right > span.left);
  const overEmpty = span => spans.some(other => other.empty && !other.leftLetter && !other.rightLetter && Math.abs(other.top.y0 - span.bottom.y0) <= 3 && other.sides.every(line => line.y0 <= span.top.y1 + tol)
    && (span.leftLetter ? other.left <= span.left + tol : Math.abs(other.left - span.left) <= tol) && (span.rightLetter ? other.right >= span.right - tol : Math.abs(other.right - span.right) <= tol));
  const least = unit * 0.7 - 2 * Math.max(4, Math.round(unit * 0.15)), kept = [];
  for (const blank of blanks) {
    if (header(blank)) continue;
    const span = pieceOf.get(blank);
    if (!span || (!span.leftLetter && !span.rightLetter)) { kept.push(blank); continue; }
    if (span.leftLetter !== span.rightLetter && firstRow(span) && overEmpty(span)) continue;
    const { cell } = span;
    if (blank.y0 !== cell.y0) { kept.push(blank); continue; }
    const start = span.leftLetter ? wordFrom(Math.round(span.left), Math.floor(cell.x1), cell.y0, cell.y1) + 1 : cell.x0;
    const end = span.rightLetter ? wordFrom(Math.round(span.right), Math.ceil(cell.x0), cell.y0, cell.y1) - 1 : cell.x1;
    if (end - start + 1 < (span.leftLetter && span.rightLetter ? unit * 0.7 : least)) continue;
    if (!span.leftLetter) { kept.push(blank); continue; }
    const x0 = Math.max(blank.x0, start);
    if (blank.x1 - x0 >= least) kept.push({ ...blank, x0, label: true });
  }
  return order(kept, unit);
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

// ---- Checkbox captions ----
// The rule, in six sentences:
//   1. A checkbox is named only by its own caption: the phrase beside it on its question's side, or one centred over
//      it alone when its line's boxes all have one and none has words beside.
//   2. Every box of a question is unsure when its side cannot be told, two of its boxes have nothing between them, its
//      captions may be shifted by one, or its numbers may be answer codes.
//   3. A box is unsure when its caption holds a sign, a dot leader, a note after "Yes", "No" or "Other", an instruction,
//      a number, price or code beside its words, or smaller or raised print.
//   4. It is unsure, unless a usual last option like "Not sure", when it has more words than every other caption, ends
//      its question unlike them, sits out of line, or alone has a capital inside.
//   5. It is unsure when it ends on a joining word, may run on into words close beyond it, the next row or another line
//      of boxes, is as near another box, or asks unlike others.
//   6. It is unsure when the reader may have misread it, a lone box has words on both sides, a long answer or prompt,
//      or a heading, or its line's boxes have words over them too.
const lettered = text => /[\p{L}\p{N}]/u.test(text);
const sure = word => (word.confidence ?? 100) > 50;
// A found checkbox is the inside of its square; the square drawn on the page reaches a little further.
const square = box => {
  const pad = Math.max(3, Math.round((box.x1 - box.x0) * 0.3));
  return { ...box, x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad };
};
// The square read into a stored word (no letters given): an opening mark and maybe a closing one, or "O" or "0". A
// closing mark that is a letter ("I", "l", "1") goes only when no small letter or digit follows it, so "[Initials" keeps
// its "I". (MARK_END keeps the small letter before an "O" as its first group: "YesO" is "Yes".) MARKED: a word that
// still holds a square's mark, the reader's word for a square findBlanks did not find.
const MARK_START = /^(?:[[({|](?:\]|[J1lI|)}](?![a-z0-9]))?)?(?:[O0](?=[A-Z][a-z]))?/;
const MARK_END = /([a-z])[O0](?:[[({|][\]J1lI|)}]?)?$|(?:[[({|][\]J1lI|)}]?)?$/, MARKED = /^[[{]|[[{][\]J1lI|}]?$/;
// The square in the reader's letters: its opening or closing side (a mark, or "I", "l", "1", and "J" on the right), or
// the whole square read as one letter.
const OPENER = /^[[({|1lI]$/, CLOSER = /^[\])}|J1lI]$/, WHOLE = /^[O0DQo□■☐]$/;
const MARK = /^[[\]|(){}_]$/, LEADER = /^[.·…_\-–]+$/, LIST = /^\(?(\d{1,3}|[A-Za-z]|[ivxIVX]{1,4})[.)]$/;
// A sign the reader returns as a word of its own between two words of a caption: a dash, an equals sign, a bullet or a
// times sign ("18 – 24", "1 = Poor", "Mon • Wed", "10 × 15 cm").
const LINK = /^[-–—=•×~]$/;
// A dot leader as the reader returns it: three dots or more, a stray letter at most one in five ("......o....").
const DOTS = text => {
  const dots = (String(text || '').trim().match(/[.·…]/g) || []).length;
  return dots >= 3 && dots >= 0.8 * String(text).trim().length;
};
// A word the reader ran into the dot leader after it ("Yes..........."), as the word and the leader, its box (and its
// letters) parted where the dots begin.
const leaderOff = word => {
  const text = String(word.text || '').trim(), found = /^(.*[\p{L}\p{N}].*?)([.·…]{3,})$/u.exec(text);
  if (!found) return [word];
  const x = Math.round(word.bbox.x0 + (word.bbox.x1 - word.bbox.x0) * found[1].length / text.length);
  const before = symbol => (symbol.bbox.x0 + symbol.bbox.x1) / 2 < x;
  const piece = (part, x0, x1, keep) => ({ ...word, text: part, bbox: { ...word.bbox, x0, x1 },
    ...(word.symbols ? { symbols: word.symbols.filter(keep) } : {}) });
  return [piece(found[1], word.bbox.x0, x, before), piece(found[2], x, word.bbox.x1, symbol => !before(symbol))];
};
// The squares a word's box runs into: over them along the line, and level with them for 40% of the word's height.
const touchingOf = (squares, wb) => squares.filter(item => Math.min(wb.x1, item.x1) - Math.max(wb.x0, item.x0) > 0
  && Math.min(wb.y1, item.y1) - Math.max(wb.y0, item.y0) >= 0.4 * (wb.y1 - wb.y0));
// The squares near a word's box, in the page's order (found through bands as high as the tallest square).
const nearSquares = squares => {
  const find = nearby(squares, item => item, Math.max(8, ...squares.map(item => item.y1 - item.y0)));
  const order = new Map(squares.map((item, at) => [item, at]));
  return wb => find(wb.y0, wb.y1).sort((a, b) => order.get(a) - order.get(b));
};

// The words a label may use. The reader's words for a checkbox's square ("[]", "[J") go; a caption the reader ran into
// a square ("Yes[]", "[JMon", "[_]Mail") loses the square's marks and keeps the rest; dots and dashes alone go. A word
// that touches no square is kept when the reader was over 50% sure of it (as before). A word that touches a square and
// comes with its letters (`symbols`, as the page reads them) is cut at the square letter by letter, split where the
// square was, and each piece kept when it has a letter or digit and the reader was sure of the word or of every letter
// in it (over 80%): a square inside a word often pulls the word's own confidence under 50. A letter or word with no
// confidence counts as sure. Each word returned keeps a confidence (the lowest of its letters), for callers.
export function cleanWords(blanks, words) {
  return pieces(blanks, words).map(({ text, confidence, bbox }) => ({ text, confidence, bbox }));
}
// cleanWords' words, each also marked `squared` when the reader read the square itself as a letter into its word ("O"
// or "E" for the square: "OYES", "Ou" for "[ ] II"), a letter of it lies a third inside the square ("XB" for "XL [ ]"),
// or its last or first letter may be the square's side ("Emai[l", "[J18-24").
function pieces(blanks, words) {
  const squares = blanks.filter(blank => blank.kind === 'check').map(square), out = [], near = nearSquares(squares);
  for (const word of words) {
    const text = String(word.text || '').trim(), wb = word.bbox, wide = wb.x1 - wb.x0;
    if (!text || LEADER.test(text)) continue;
    const touching = touchingOf(near(wb), wb);
    if (!touching.length) { if (sure(word)) out.push({ text, confidence: word.confidence, bbox: wb }); continue; }
    if (word.symbols?.length) {
      const parts = [[]], part = () => parts[parts.length - 1], cut = () => { if (part().length) parts.push([]); };
      let squared = false;
      word.symbols.forEach((symbol, at) => {
        const b = symbol.bbox, x = (b.x0 + b.x1) / 2, y = (b.y0 + b.y1) / 2, char = symbol.text, outside = (b.x1 - b.x0) / 4;
        const level = item => y >= item.y0 - 4 && y <= item.y1 + 4;
        const over = touching.find(item => x >= item.x0 && x <= item.x1 && level(item));
        if (!over) {
          // The square's closing side read as a letter just after it, starting inside it: a "J" or a bracket goes unless
          // a small letter or a digit follows it ("[JMon"); a "1", "l" or "I", or a "J" before a digit ("[J18-24", "[IM"),
          // may be the square's or the caption's own first letter, so the word is doubtful, unless a small letter
          // follows ("[Initials").
          const side = touching.some(item => b.x0 < item.x1 && x > item.x1 && level(item)) && CLOSER.test(char);
          const next = word.symbols[at + 1]?.text || '';
          if (side && /^[\])}|J]$/.test(char) && !/^[a-z0-9]/.test(next)) { cut(); return; }
          if (side && !/^[a-z]/.test(next)) squared = true;
          if (touching.some(item => 3 * (Math.min(b.x1, item.x1) - Math.max(b.x0, item.x0)) >= b.x1 - b.x0 && level(item))) squared = true;
          part().push(symbol);
          return;
        }
        // A letter the reader stretched over the square from outside it (the "s" of "Yes" reaching into the box), a
        // quarter of it outside at least, is the caption's, its box cut at the square's edge. A mark, a side of the square
        // read as a letter, or the whole square read as one, is the square.
        if (over.x0 - b.x0 >= outside && lettered(char) && !OPENER.test(char) && !WHOLE.test(char)) {
          part().push({ ...symbol, bbox: { ...b, x1: over.x0 } });
          return;
        }
        // An "l", "1" or "I" from outside, a quarter of it outside at least and as wide as most of the square (the reader
        // ran the caption's last letter into the square: "Emai[l"), may be that letter or the square's side: kept, and
        // its word doubtful.
        if (over.x0 - b.x0 >= outside && 4 * (b.x1 - b.x0) >= 3 * (over.x1 - over.x0) && /^[1lI]$/.test(char)) {
          squared = true;
          part().push({ ...symbol, bbox: { ...b, x1: over.x0 } });
          return;
        }
        if (b.x1 - over.x1 >= outside && lettered(char) && !CLOSER.test(char) && !WHOLE.test(char)) {
          cut();
          part().push({ ...symbol, bbox: { ...b, x0: over.x1 } });
          return;
        }
        if (lettered(char) && !CLOSER.test(char)) squared = true;
        cut();
      });
      for (let list of parts) {
        while (list.length && MARK.test(list[0].text)) list = list.slice(1);
        while (list.length && MARK.test(list[list.length - 1].text)) list = list.slice(0, -1);
        const joined = list.map(symbol => symbol.text).join('');
        if (!list.length || !lettered(joined) || !(sure(word) || list.every(symbol => (symbol.confidence ?? 100) > 80))) continue;
        // The piece's box ends where the square begins (or begins where it ends), as for a stored word below, so the
        // caption is not taken to reach into the square.
        let x0 = Math.min(...list.map(symbol => symbol.bbox.x0)), x1 = Math.max(...list.map(symbol => symbol.bbox.x1));
        for (const item of touching) {
          if ((x0 + x1) / 2 < (item.x0 + item.x1) / 2) x1 = Math.min(x1, item.x0); else x0 = Math.max(x0, item.x1);
        }
        if (x1 > x0) {
          const confidence = Math.round(Math.min(...list.map(symbol => symbol.confidence ?? 100)));
          out.push({ text: joined, confidence, bbox: { x0, y0: wb.y0, x1, y1: wb.y1 }, ...(squared ? { squared } : {}) });
        }
      }
      continue;
    }
    // No letters given (stored words): the square's marks are taken off by their shapes.
    if (!sure(word)) continue;
    const box = touching[0], over = Math.min(wb.x1, box.x1) - Math.max(wb.x0, box.x0), side = box.x1 - box.x0;
    if (over >= 0.6 * wide && wide <= 1.6 * side) continue;                       // the reader's word for the square itself
    const before = (wb.x0 + wb.x1) / 2 < (box.x0 + box.x1) / 2;
    const rest = over >= 0.4 * side ? (before ? text.replace(MARK_END, '$1') : text.replace(MARK_START, '')) : text;
    const mark = before ? text.slice(rest.length) : text.slice(0, text.length - rest.length);
    if (rest && lettered(rest)) {
      const bbox = before ? { ...wb, x1: Math.min(wb.x1, box.x0) } : { ...wb, x0: Math.max(wb.x0, box.x1) };
      out.push({ text: rest, confidence: word.confidence, bbox, ...(lettered(mark.replace(/[J1lI]/g, '')) ? { squared: true } : {}) });
    }
  }
  return out;
}

// A table's rule the reader ran into a caption's last letter ("Water|", "free]"): the word, then the rule.
const unglue = word => {
  const found = /^(.*[\p{L}\p{N}].*?)[|\]]$/u.exec(word.text);
  if (!found || /\[/.test(found[1])) return [word];
  const wide = (word.bbox.x1 - word.bbox.x0) / word.text.length;
  return [{ ...word, text: found[1], bbox: { ...word.bbox, x1: word.bbox.x1 - wide } },
    { ...word, text: '|', bbox: { ...word.bbox, x0: word.bbox.x1 - wide } }];
};
// Words as a label: a "|" or an "l" alone before a small letter is the reader's "I" ("| agree"); a "|" elsewhere is a
// rule, and goes; a closing ":" or "_" goes.
const say = list => list.map((word, at) => /^[|l]$/.test(word.text) && /^[a-z]/.test(list[at + 1]?.text || '') ? 'I'
  : word.text === '|' ? '' : word.text).filter(Boolean).join(' ').replace(/[\s:_]+$/, '').trim();
// The reader's "I" may come back as a "1" ("1 agree", or a number: "1 day"), or, before a capital, as a "|" or "l" ("|
// Agree", or a table's rule), or run into the next word ("|Agree"). Such a word is doubtful: both readings.
const doubtfulI = (word, next) => (word.text === '1' && /^[a-z]/.test(next?.text || ''))
  || (/^[|1l]$/.test(word.text) && /^\p{Lu}/u.test(next?.text || '')) || /^[|1lI](?=\p{Lu}\p{Ll})/u.test(word.text);
const oneOrI = list => list.some((word, at) => doubtfulI(word, list[at + 1]));
const asI = list => list.flatMap((word, at) => !doubtfulI(word, list[at + 1]) ? [word]
  : word.text.length > 1 ? [{ ...word, text: 'I' }, { ...word, text: word.text.slice(1) }] : [{ ...word, text: 'I' }]);
const withoutI = list => list.flatMap((word, at) => !doubtfulI(word, list[at + 1]) || word.text === '1' ? [word]
  : word.text.length > 1 ? [{ ...word, text: word.text.slice(1) }] : []);

// A question or a field's own prompt ends with ":" or "?"; CODE: an option's code and colon ("A:", "2:"); PRICE: a
// price ("$25", "£8.50", "80p"); ANSWER: a bare number, a single letter or a list's number, which may be an answer code.
const QUESTION = /[:?]$/, CODE = /^(?:\d{1,3}|[A-Za-z]|[ivxIVX]{1,4}):$/, PRICE = /^[^\p{L}]*(?:[$£€¥₹]|\d[.,]\d\d)[^\p{L}]*$|^\d+p$/u;
const ANSWER = text => /^(?:\d{1,3}|\p{L})$/u.test(text) || LIST.test(text);
// A caption that may hold an answer code or a price beside its words: a number or a price anywhere among words with
// letters ("1 Yes", "Yes 1", "Adult 12", "Tea 80p", "Under 18"), a list's number first, a single letter first or last
// ("A Bus", "Bus A"; not the "I" of "I agree"), or digits run into letters ("2No", "Never1").
const coded = words => words.some(word => /\p{L}\d|^\d+\p{Lu}/u.test(word.text)) || (words.length > 1
  && words.some(word => /\p{L}/u.test(word.text)) && (words.some(word => /^\d+$/.test(word.text) || PRICE.test(word.text))
  || LIST.test(words[0].text) || /^\p{L}$/u.test(words[words.length - 1].text)
  || (/^\p{L}$/u.test(words[0].text) && !/^I \p{Ll}/u.test(say(words)))));
// The usual last options of a list, each a whole caption by itself: the ways of giving no answer or none ("Not sure",
// "Prefer not to say") and a scale's ends ("Strongly disagree").
const USUAL = new Set(['not sure', "don't know", 'do not know', "i don't know", 'not known', 'none known', 'prefer not to say',
  'prefer not to answer', 'rather not say', 'decline to answer', 'not applicable', 'does not apply', 'no preference', 'no opinion',
  'no answer', 'ne sait pas', 'je ne sais pas', 'sans opinion', 'no sé', 'no sabe', 'strongly agree', 'strongly disagree',
  'very satisfied', 'very dissatisfied', 'not satisfied', 'very likely', 'very unlikely', 'not at all', 'very good', 'very poor',
  'none of the above']);
const usual = words => USUAL.has(words.map(word => word.text).join(' ').toLowerCase().replace(/’/g, "'"));
const lastWord = phrase => phrase.words[phrase.words.length - 1].text;
// A phrase that asks: it ends in "?", or in ":" after a word that is no option's code ("Shift:", not "Plan A:").
const asks = phrase => /\?$/.test(lastWord(phrase)) || (/:$/.test(lastWord(phrase)) && !CODE.test(lastWord(phrase)));
// Where a note may begin in a caption, or -1: after a first word that is an answer by itself, "Yes", "No" or "Other"
// ("Yes give details below", "No go on", "Other specify"), or at an instruction's word or a question's number after the
// first word ("I need an interpreter state language", "Never Q7"). A usual last option holds none ("No answer").
const INSTRUCTION = new Set(['give', 'specify', 'state', 'describe', 'explain', 'elaborate', 'clarify', 'detail', 'tell', 'show',
  'tick', 'mark', 'circle', 'select', 'choose', 'complete', 'write', 'provide', 'enter', 'attach', 'include', 'add', 'bring',
  'indicate', 'go', 'skip', 'turn', 'proceed', 'continue', 'see', 'please', 'ask']);
const noteAt = words => usual(words) ? -1 : words.length > 1 && /^(?:yes|no|other)$/i.test(words[0].text) ? 1
  : words.findIndex((word, at) => at > 0 && (INSTRUCTION.has(word.text.toLowerCase()) || /^Q\.?\d+[a-z]?$/i.test(word.text)));
// A word no caption ends on: it joins what follows ("Send me news about", "Grandparent or").
const GLUE = /^(?:and|or|of|the|a|an|to|for|with|from|about|our|your|my|their)$/i;
// A caption's text before the first sign after which a note may follow, or '' when there is none: a bracket ("Yes (see
// note 3)", "Yes(Q4)"), a dash, a comma, a semicolon or a colon, or any other mark set apart by a space ("Yes / Oui",
// "Yes • Go", "Yes →Go", "Yes ...See"), with letters or digits on both sides. No sign: a mark inside a word
// ("Self-employed", "N/A"), a bracket holding a word's ending ("Casado(a)", "Name(s)"; one letter only when s, e, n or
// r, or a after o), a mark between two numbers ("18 – 24", "20,000").
function noteBefore(text) {
  for (let at = 1; at < text.length - 1; at++) {
    const sign = text[at], prior = text[at - 1], before = text.slice(0, at).trim(), after = text.slice(at + 1).trim();
    if (/[\p{L}\p{N}\s'’)\]]/u.test(sign) || (sign === '.' && prior !== ' ') || !lettered(before) || !lettered(after)) continue;
    const inside = /^(\p{Ll}{1,3})\)/u.exec(after)?.[1] || '';
    const ending = sign === '(' && /\p{L}/u.test(prior)
      && (inside.length > 1 || /^[senr]$/.test(inside) || (inside === 'a' && prior === 'o'));
    const numbers = sign !== '(' && /\d$/.test(before) && /^\d/.test(after);
    if (!ending && !numbers && (/[([–—,;:]/.test(sign) || prior === ' ' || text[at + 1] === ' ')) return before;
  }
  return '';
}
// A word that opens the words after it: a list's number first in a phrase ("1. Yes"), a title ("Dr. Okafor") or an
// abbreviation with full stops ("U.S. Citizen"): its full stop ends no sentence. A phrase is `capitalised` when another
// phrase may begin inside it: a capitalised word after the first (not "I", an initial, or a word such a word opens).
const TITLE = /^(?:Mr|Mrs|Ms|Mx|Dr|St|Ste|Mt|Jr|Sr|Sra|Srta|Prof|Rev|Fr|Mme|Mlle|Hon|Capt|Lt|Col|Sgt|Cpl|Maj|Cdr|Insp|Det|Supt)\.$/;
const opens = (words, at) => (at === 0 && LIST.test(words[0].text)) || TITLE.test(words[at].text)
  || /^\p{L}{1,3}(?:\.\p{L}{1,3})+\.?$/u.test(words[at].text);
const capitalised = words => words.some((word, at) => at > 0 && /^\p{Lu}/u.test(word.text) && word.text !== 'I'
  && !/^\p{Lu}\.$/u.test(word.text) && !opens(words, at - 1));
// Two captions' far words are alike when they are the same word, give or take a plural "s" ("Day shift", "Night
// shift"). A caption's count of words leaves out signs.
const alike = (a, b) => a.toLowerCase().replace(/s$/, '') === b.toLowerCase().replace(/s$/, '');
const count = words => words.filter(word => lettered(word.text)).length;
// How much nearer one box a phrase must be to be that box's alone: at most three quarters as far, and a quarter of a
// text height nearer at least, so a tie is never broken by a small spacing difference.
const clearly = (near, far, unit) => near <= far * 0.75 && far - near >= unit * 0.25;
// How far two spans overlap (less than 0 when apart); a word's height; two words on one text row (they share half the
// smaller one's height). A word whose height shows its print size: a capital, a digit or a tall small letter, and
// nothing that hangs below the line.
const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0), high = word => word.bbox.y1 - word.bbox.y0;
const levelWords = (a, b) => overlap(a.bbox.y0, a.bbox.y1, b.bbox.y0, b.bbox.y1) >= 0.5 * Math.min(high(a), high(b));
const measured = word => /[\p{Lu}\p{N}bdfhkl]/u.test(word.text) && !/[gjpqy()[\]{},;]/.test(word.text);

// The items near a stretch of the page's height, found without looking at every item: each is kept in the bands of
// the page (`size` high) that its box covers.
function nearby(items, boxOf, size) {
  const bands = new Map();
  for (const item of items) {
    const box = boxOf(item);
    for (let k = Math.floor(box.y0 / size); k <= Math.floor(box.y1 / size); k++) (bands.get(k) || bands.set(k, []).get(k)).push(item);
  }
  return (y0, y1) => {
    const found = new Set();
    for (let k = Math.floor(y0 / size); k <= Math.floor(y1 / size); k++) for (const item of bands.get(k) || []) found.add(item);
    return [...found];
  };
}

// The usual space between two words of a phrase on this page (`size`): the median gap between a word and the next one
// on its text row, both with letters, when the page has eight such gaps or more; never less
// than three tenths of a text height. `wide`: how many such spaces apart two phrases may still be one: two and a half
// where the page's own space was measured, else two.
function wordSpace(words, unit) {
  const gaps = [], nearWords = nearby(words, word => word.bbox, unit);
  for (const word of words) {
    let next = null;
    for (const other of nearWords(word.bbox.y0, word.bbox.y1)) {
      const gap = other.bbox.x0 - word.bbox.x1;
      if (other !== word && gap >= 0 && gap <= unit * 2 && (!next || gap < next.gap) && levelWords(word, other)) next = { gap, other };
    }
    if (next && /\p{L}/u.test(word.text) && /\p{L}/u.test(next.other.text)) gaps.push(next.gap);
  }
  const median = gaps.length >= 8 ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
  return { size: Math.max(median, unit * 0.3), wide: median >= unit * 0.3 ? 2.5 : 2 };
}

// The lines of checkboxes on a page. Two boxes are on one row when their squares overlap by half a square's height.
// Each box is joined to the nearest box on its right on its row, when that box's nearest on its left is this one: a
// line that bends in a photo stays one line, and the rows of a tilted grid stay apart. A box listed twice goes with its
// first copy. Each line left to right.
function linesOf(boxes, unit) {
  const level = (a, b) => overlap(a.sq.y0, a.sq.y1, b.sq.y0, b.sq.y1) >= 0.5 * Math.min(a.sq.y1 - a.sq.y0, b.sq.y1 - b.sq.y0);
  const before = (a, b) => a.blank.x0 < b.blank.x0 || (a.blank.x0 === b.blank.x0 && a.blank.y0 < b.blank.y0);
  const place = box => [box.blank.x0, box.blank.y0, box.blank.x1, box.blank.y1].join(' '), copies = new Map();
  for (const box of boxes) copies.set(place(box), [...(copies.get(place(box)) || []), box]);
  const firsts = [...copies.values()].map(list => list[0]).sort((a, b) => before(a, b) ? -1 : before(b, a) ? 1 : 0);
  const near = nearby(firsts, box => box.sq, unit), next = new Map(), joined = new Set();
  const nearest = (box, right) => near(box.sq.y0, box.sq.y1)
    .filter(other => level(box, other) && (right ? other.blank.x0 > box.blank.x0 : other.blank.x0 < box.blank.x0))
    .reduce((best, other) => !best || (right ? before(other, best) : before(best, other)) ? other : best, null);
  for (const box of firsts) {
    const other = nearest(box, true);
    if (other && nearest(other, false) === box) { next.set(box, other); joined.add(other); }
  }
  return firsts.filter(box => !joined.has(box)).map(first => {
    const line = [first];
    while (next.has(line[line.length - 1])) line.push(next.get(line[line.length - 1]));
    return line.flatMap(box => copies.get(place(box)));
  });
}
// The box of a line nearest to x0..x1 along the line.
const nearestOf = (line, x0, x1) => line.reduce((best, box) => {
  const far = Math.max(box.sq.x0 - x1, x0 - box.sq.x1, 0);
  return !best || far < best.far ? { box, far } : best;
}, null).box;

// Words as phrases: words one after another with no more than a third over the usual word space between them (wider
// for print larger than the page's own, up to twice; twice beside a dot leader and after a list's number), not past a
// word ending in ":" or "?". A dot leader is not said, nor a sign at either end; `led`: where the words after a dot
// leader inside the phrase begin, or -1. `next`: how many word spaces lie before the next phrase. A phrase with nothing
// to say (a lone "|", a table's rule) is none, but marks the phrase after it `barred` (the "|" may be the reader's
// "I"). Words in two text rows are one phrase, read row by row. `faint`: 'all' when the reader was unsure of every
// word, 'some' of some.
function phrasesOf(words, space, unit) {
  const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0), phrases = [], mid = word => (word.bbox.x0 + word.bbox.x1) / 2;
  let bar = false;
  const add = (list, next = Infinity) => {
    const spoken = list.filter((word, at) => !word.leader && !(word.link && (at === 0 || at === list.length - 1))
      && !(at === list.length - 1 && /^[/&+]$/.test(word.text)));
    if (!lettered(say(spoken))) { bar = list.some(word => word.text === '|'); return; }
    const faint = spoken.filter(word => word.faint).length;
    const leader = list.find(word => word.leader && mid(word) > mid(spoken[0]) && mid(word) < mid(spoken[spoken.length - 1]));
    phrases.push({ words: spoken, x0: Math.min(...list.map(word => word.bbox.x0)), x1: Math.max(...list.map(word => word.bbox.x1)),
      next, led: leader ? spoken.findIndex(word => mid(word) > mid(leader)) : -1, barred: bar,
      faint: faint === spoken.length ? 'all' : faint ? 'some' : '' });
    bar = false;
  };
  // Two text rows: a word starts before the one before it ends, and the two are not level.
  if (sorted.some((word, at) => at && word.bbox.x0 < sorted[at - 1].bbox.x1 - 2 && !levelWords(word, sorted[at - 1]))) {
    const rows = [];
    for (const word of [...words].sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1))) {
      const row = rows.find(item => levelWords(item[0], word));
      if (row) row.push(word); else rows.push([word]);
    }
    add(rows.flatMap(row => row.sort((a, b) => a.bbox.x0 - b.bbox.x0)));
    return phrases;
  }
  // The gap before a word is measured from where the phrase so far reaches (a word may lie over a dot leader).
  let current = [], reach = -Infinity;
  for (const word of sorted) {
    const before = current[current.length - 1], gap = word.bbox.x0 - reach;
    const usual = before && space.size * Math.min(2, Math.max(1, Math.min(high(before), high(word)) / unit));
    const holds = before && (before.leader || word.leader || (current.length === 1 && LIST.test(before.text)));
    if (before && (QUESTION.test(before.text) || gap > usual * (holds ? 2 : 1.35))) {
      add(current, gap / usual);
      current = [];
    }
    current.push(word); reach = current.length > 1 ? Math.max(reach, word.bbox.x1) : word.bbox.x1;
  }
  if (current.length) add(current);
  return phrases;
}

// Every checkbox's caption on a page: for each blank, null (not a checkbox), { words }, { unsure: [readings] }, { above }
// (the words printed above it) or {} (no caption). Each line of boxes is read once (readLine).
function captions(blanks, words, unit) {
  const out = blanks.map(() => null);
  const boxes = blanks.flatMap((blank, index) => blank.kind === 'check' ? [{ index, blank, sq: square(blank) }] : []);
  if (!boxes.length) return out;
  const space = wordSpace(words.filter(word => !word.leader), unit), lines = linesOf(boxes, unit);
  const nearBoxes = nearby(boxes, box => box.sq, unit), apart = (a, b) => Math.max(a.x0 - b.x1, b.x0 - a.x1);
  // The words of the lines (a table's rule the reader ran into a word taken off it). Each word goes to the line whose
  // box nearest to it along the line, within twenty text heights, holds the word's middle within its square's height;
  // then, as a printed line may bend in a photo, a word level with a word of a line (at most two text heights away)
  // joins that line too, unless that word is one the reader could not read. Words on no line (`free`) may be printed
  // over a box, or carry a caption on.
  const kept = words.flatMap(unglue).filter(word => lettered(word.text) || /^[|/&+]$/.test(word.text) || word.leader || word.link);
  const lineOf = new Map(), lineAt = new Map();
  lines.forEach((line, at) => line.forEach(box => { lineAt.set(box, at); box.line = line; }));
  for (const word of kept) {
    const middle = (word.bbox.y0 + word.bbox.y1) / 2;
    let best = null;
    for (const at of [...new Set(nearBoxes(middle, middle).map(box => lineAt.get(box)))].sort((a, b) => a - b)) {
      const box = nearestOf(lines[at], word.bbox.x0, word.bbox.x1), off = Math.abs(middle - (box.sq.y0 + box.sq.y1) / 2);
      const fits = middle >= box.sq.y0 && middle <= box.sq.y1 && apart(box.sq, word.bbox) <= unit * 20;
      if (fits && (!best || off < best.off)) best = { at, off };
    }
    if (best) lineOf.set(word, best.at);
  }
  const nearKept = nearby(kept, word => word.bbox, unit), rank = new Map(kept.map((word, at) => [word, at]));
  for (const reached = [...lineOf.keys()]; reached.length;) {
    const word = reached.pop();
    for (const other of word.faint ? [] : nearKept(word.bbox.y0, word.bbox.y1).sort((a, b) => rank.get(a) - rank.get(b))) {
      if (lineOf.has(other) || !levelWords(word, other) || apart(word.bbox, other.bbox) > unit * 2) continue;
      lineOf.set(other, lineOf.get(word));
      reached.push(other);
    }
  }
  const nearFree = nearby(kept.filter(word => !lineOf.has(word) && !word.faint && !MARKED.test(word.text)), word => word.bbox, unit);
  const nearOthers = nearby(blanks.filter(blank => blank.kind !== 'check'), blank => blank, unit);
  const order = new Map(blanks.map((blank, at) => [blank, at]));
  // The free words (or `all` the words but the reader's marks for a square and those of the words' own line) of the text
  // row just over or just under some words (within 1.6 text heights), found from a word over x0..x1, as phrases; and the
  // boxes of other lines in a box's column (overlapping it by half its width) from y0 to y1.
  const rowNear = (list, under, x0, x1, all = false) => {
    const top = Math.min(...list.map(word => word.bbox.y0)), bottom = Math.max(...list.map(word => word.bbox.y1));
    const near = (all ? nearKept : nearFree)(under ? bottom - 2 : top - unit * 1.6, under ? bottom + unit * 1.6 : top + 2).filter(word =>
      (!all || (lineOf.get(word) !== lineOf.get(list[0]) && !MARKED.test(word.text))) && (under ? word.bbox.y0 >= bottom - 2
        && word.bbox.y0 - bottom < unit * 1.6 : word.bbox.y1 <= top + 2 && top - word.bbox.y1 < unit * 1.6));
    const first = near.filter(word => word.bbox.x0 < x1 && word.bbox.x1 > x0)
      .sort((a, b) => under ? a.bbox.y0 - b.bbox.y0 : b.bbox.y1 - a.bbox.y1)[0];
    return first ? phrasesOf(near.filter(word => levelWords(word, first)), space, unit) : [];
  };
  // A phrase of a text row that begins something of its own: a note in brackets, a list's item, or another field's
  // prompt (a blank level with it begins within a text height after it); `boxed`, or a box's own (a box level with it
  // ends or begins within a text height of it). Level: the item's middle within the phrase's first word's height.
  const begins = (phrase, boxed) => {
    const { text, bbox } = phrase.words[0], level = item => Math.abs(item.y0 + item.y1 - bbox.y0 - bbox.y1) <= bbox.y1 - bbox.y0;
    return /^\(/.test(text) || LIST.test(text) || nearOthers(bbox.y0, bbox.y1).some(blank => level(blank)
      && Math.abs(blank.x0 - phrase.x1) <= unit) || (boxed && nearBoxes(bbox.y0, bbox.y1).some(box => level(box.sq)
      && (Math.abs(phrase.x0 - box.sq.x1) <= unit || Math.abs(box.sq.x0 - phrase.x1) <= unit)));
  };
  const width = box => box.sq.x1 - box.sq.x0;
  const column = (box, y0, y1) => nearBoxes(y0, y1).filter(other => other.line !== box.line && other.sq.y0 >= y0 - 2
    && other.sq.y1 <= y1 + 2 && overlap(other.sq.x0, other.sq.x1, box.sq.x0, box.sq.x1) >= 0.5 * Math.min(width(other), width(box)));
  // The phrases printed over each box: on the text row just over it, over its square; `head`, its own one, the only
  // phrase over it and over no other box of its line. A line is headed when every box of it has its own phrase (a box
  // alone only when it is centred over it), or a headed box straight above it in its column. The top line first.
  const over = (phrase, box) => phrase.x0 < box.sq.x1 && phrase.x1 > box.sq.x0;
  const centred = box => Math.abs((box.head.x0 + box.head.x1) / 2 - (box.blank.x0 + box.blank.x1) / 2) <= unit / 3;
  for (const line of [...lines].sort((a, b) => Math.min(...a.map(box => box.sq.y0)) - Math.min(...b.map(box => box.sq.y0)))) {
    for (const box of line) {
      box.over = rowNear([{ bbox: box.sq }], false, box.sq.x0, box.sq.x1).filter(phrase => over(phrase, box));
      box.head = box.over.length === 1 && !line.some(other => other !== box && over(box.over[0], other)) ? box.over[0] : null;
    }
    line.headed = line.every(box => (box.head && (line.length > 1 || centred(box)))
      || column(box, box.sq.y0 - unit * 4, box.sq.y0).some(other => other.line.headed));
  }
  const onLines = lines.map(() => []);
  for (const word of kept) if (lineOf.has(word)) onLines[lineOf.get(word)].push(word);
  lines.forEach((line, at) => readLine(line, onLines[at], at));
  return out;

  function readLine(line, words, here) {
    // The line as items left to right: its boxes; the other blanks on it, the reader's marks for a square findBlanks did
    // not find ("[Thu"), and a table's rule (a "|", or the "l" or "I" the reader read for one, within half a text height
    // before a box), which part it; and words, a word a blank runs into (letters inside a box findBlanks saw over them)
    // read as unread. Each box gets the stretch of words before it and after it.
    const top = Math.min(...line.map(box => box.blank.y0)), bottom = Math.max(...line.map(box => box.blank.y1));
    const stops = nearOthers(top, bottom).sort((a, b) => order.get(a) - order.get(b)).filter(blank => {
      const box = nearestOf(line, blank.x0, blank.x1).blank;
      return overlap(blank.y0, blank.y1, box.y0, box.y1) >= 0.5 * Math.min(blank.y1 - blank.y0, box.y1 - box.y0);
    });
    const into = (word, blank) => overlap(word.bbox.x0, word.bbox.x1, blank.x0, blank.x1) > 2
      && overlap(word.bbox.y0, word.bbox.y1, blank.y0, blank.y1) > 0;
    const rule = word => /^[|lI]$/.test(word.text)
      && line.some(box => box.sq.x0 - word.bbox.x1 >= -2 && box.sq.x0 - word.bbox.x1 <= unit / 2);
    const items = [...line.map(box => ({ x0: box.sq.x0, box })), ...stops.map(blank => ({ x0: blank.x0, stop: true, blank })),
      ...words.map(word => MARKED.test(word.text) || rule(word) ? { x0: word.bbox.x0, stop: true, mark: true }
        : { x0: word.bbox.x0, word: stops.some(blank => into(word, blank)) ? { ...word, faint: true } : word })];
    let stretch = { words: [], from: null };
    for (const item of [...items.sort((a, b) => a.x0 - b.x0), { end: true }]) {
      if (item.word) { stretch.words.push(item.word); continue; }
      stretch.to = item.end ? null : item; stretch.phrases = phrasesOf(stretch.words, space, unit);
      if (item.box) item.box.before = stretch;
      stretch = { words: [], from: item };
      if (item.box) item.box.after = stretch;
    }
    // On a photo turned a little, the words of one printed line may go to two lines of boxes: a phrase whose first or
    // last word has, just before or after it, a word of another line level with it for a third of its height, or a box
    // of another line whose square holds its middle, may begin or end on that line (`strays`).
    const y0 = Math.min(top, ...words.map(word => word.bbox.y0)), y1 = Math.max(bottom, ...words.map(word => word.bbox.y1));
    const strangers = nearKept(y0, y1).filter(other => lineOf.get(other) !== here && lineOf.has(other) && lettered(other.text)
      && !other.leader);
    const neighbours = nearBoxes(y0, y1).filter(box => lineAt.get(box) !== here);
    const stray = (word, after) => {
      const gap = item => after ? item.x0 - word.bbox.x1 : word.bbox.x0 - item.x1, middle = (word.bbox.y0 + word.bbox.y1) / 2;
      const near = item => gap(item) >= -2 && gap(item) <= space.size * space.wide;
      const third = other => overlap(word.bbox.y0, word.bbox.y1, other.bbox.y0, other.bbox.y1) >= Math.min(high(word), high(other)) / 3;
      return strangers.some(other => third(other) && near(other.bbox))
        || neighbours.some(box => middle >= box.sq.y0 && middle <= box.sq.y1 && near(box.sq));
    };
    const strays = phrase => stray(phrase.words[0], false) || stray(phrase.words[phrase.words.length - 1], true);

    // A box's phrase on one side: the nearest, within reach (four text heights on its right, twelve on its left, as far
    // as labels go). Between two boxes, a phrase that is clearly the other box's is not this one's, and one about as near
    // both is `shared`. `beyond`: the next phrase out from the box, `spaces` (word spaces) away.
    const candidate = (box, side) => {
      const each = side === 'left' ? box.before : box.after, phrases = each.phrases, at = side === 'left' ? phrases.length - 1 : 0;
      const phrase = phrases[at], other = side === 'left' ? each.from?.box : each.to?.box;
      if (!phrase) return null;
      const gap = side === 'left' ? box.sq.x0 - phrase.x1 : phrase.x0 - box.sq.x1, beyond = phrases[side === 'left' ? at - 1 : at + 1];
      const far = other && phrases.length === 1 ? (side === 'left' ? phrase.x0 - other.sq.x1 : other.sq.x0 - phrase.x1) : Infinity;
      if (clearly(far, gap, unit) || gap > unit * (side === 'left' ? 12 : 4)) return null;
      return { phrase, gap, far, own: clearly(gap, far, unit) ? 'own' : 'shared', side, each, beyond,
        spaces: !beyond ? Infinity : side === 'left' ? beyond.next : phrase.next };
    };
    for (const box of line) { box.left = candidate(box, 'left'); box.right = candidate(box, 'right'); }
    // A phrase that is only a list's number, or asks (and on a box's right has no words after it), or is a field's
    // prompt (just before another blank), is no box's own words (`said`). `readings`: what a box's caption might be, the
    // phrase beside it on either side (not a question beside a box of a question of two boxes or more).
    const prompt = found => found.side === 'right' && Boolean(found.each.to?.stop && !found.each.to.mark) && !found.beyond
      && found.each.to.x0 - found.phrase.x1 <= unit * 1.2;
    const asking = found => (found.phrase.words.length === 1 && LIST.test(lastWord(found.phrase)))
      || (asks(found.phrase) && !(found.side === 'right' && found.beyond));
    const said = found => Boolean(found) && found.phrase.faint !== 'all' && !asking(found) && !prompt(found);
    const readings = (box, group) => ['left', 'right'].map(side => box[side]).filter(found => found && found.phrase.faint !== 'all'
      && !(group.length > 1 && QUESTION.test(lastWord(found.phrase)))).map(found => say(found.phrase.words));
    if (line.headed) return headed();
    // Questions: boxes in a row, not parted by another blank, by two phrases or more (one box's caption, then the next
    // box's), by a phrase that asks, or by nothing when each of the two boxes has its own words on its far side, clearly
    // nearer it than the other box ("Yes [ ]    [ ] No"); two boxes with nothing between them are otherwise a run of one
    // question.
    const groups = [], ownWords = (found, gap) => said(found) && found.own === 'own' && clearly(found.gap, gap, unit);
    for (const box of line) {
      const between = box.before, from = between.from?.box, gap = from ? box.sq.x0 - from.sq.x1 : 0;
      const parted = !between.phrases.length && ownWords(from?.left, gap) && ownWords(box.right, gap);
      const joins = from && between.phrases.length < 2 && !(between.phrases[0] && asks(between.phrases[0])) && !parted;
      if (joins) groups[groups.length - 1].push(box); else groups.push([box]);
    }
    groups.forEach(decide);

    function decide(group) {
      const unsure = () => group.forEach(box => { out[box.index] = readings(box, group).length ? { unsure: readings(box, group) } : {}; });
      const first = group[0], last = group[group.length - 1];
      // Two boxes with nothing between them: the words beside them are a row's label or a question, no box's caption.
      if (group.some((box, at) => at && !box.before.phrases.length)) return unsure();
      // Answer codes: a bare number, a single letter or a list's number ending within half a text height before a box,
      // mixed when other words come before it in its phrase or in another phrase there that asks nothing ("Yes 1 [ ]",
      // "1 [ ] Yes 2 [ ] No", "Number of guests ...... 1 [ ]"). Which words are whose cannot be told: a box with a mixed
      // code is unsure, and with codes before two boxes, one of them mixed, the whole question.
      const codes = group.map(box => {
        const phrases = box.before.phrases, last = phrases[phrases.length - 1], word = last?.words[last.words.length - 1];
        if (!word || !ANSWER(word.text) || box.sq.x0 - word.bbox.x1 > unit / 2) return null;
        return count(last.words) > 1 || phrases.slice(0, -1).some(phrase => !asks(phrase)) ? 'mixed' : 'code';
      });
      const mixed = group.filter((box, at) => codes[at] === 'mixed');
      if (mixed.length && codes.filter(Boolean).length > 1) return unsure();
      if (mixed.length) out[mixed[0].index] = { unsure: readings(mixed[0], group) };
      if (group.length === 1) return mixed.length ? null : lone(first);
      // The side: from the phrases between the boxes that are clearly one box's, else from the one end with words.
      const votes = group.slice(1).map((box, at) => [group[at].right, box.left].find(found => found?.own === 'own')).filter(Boolean);
      const toRight = votes.filter(found => found.side === 'right').length;
      if ((toRight && toRight < votes.length) || (!votes.length && said(first.left) === said(last.right))) return unsure();
      const side = toRight || (!votes.length && said(last.right)) ? 'right' : 'left', end = side === 'right' ? last : first;
      // The captions may be shifted by one box: the other end has words, and the far end box has no caption of its own
      // (nothing, a prompt, or on the left a question), or they are words of its own, not clearly further from the near
      // end box than its caption, unless every phrase between the boxes is at least twice as near its own box as the
      // next and those words are before the first box (the question) or are a note in brackets or a mark. Numbers,
      // prices or codes for every caption, with words that have letters beside the boxes or words printed over them,
      // may be answer codes.
      const lead = side === 'right' ? first : last, other = side === 'right' ? first.left : last.right, far = end[side];
      const decisive = votes.length && votes.every(found => found.gap <= found.far / 2)
        && (side === 'right' || /^\(|^[^\p{L}]*$/u.test(say(other?.phrase.words || [])));
      const nothing = !far || prompt(far) || (side === 'left' && asking(far));
      const near = said(other) && !decisive && !(lead[side] && clearly(lead[side].gap, other.gap, unit));
      if (other && other.phrase.faint !== 'all' && (nothing || near)) return unsure();
      const all = group.map(box => box[side]).filter(Boolean);
      const wordy = phrase => phrase && !asks(phrase) && /\p{L}/u.test(say(phrase.words));
      const letters = group.some(box => [box.left, box.right].some(found => found && (wordy(found.phrase) || wordy(found.beyond))));
      if (all.every(found => !/\p{L}/u.test(say(found.phrase.words))) && (letters || group.some(box => box.over.length))) return unsure();
      // Each box's caption, against the others of its question: unsure when it is about as near the next box as its own
      // while other captions are clearly their boxes'; unless it is a usual last option, when it has more words than every
      // other, or, as its end caption (no box beyond it), has two words or more and ends unlike all of them (on the
      // left, begins unlike them), or lies much further from its box than they do from theirs, or alone has a capitalised
      // word after its first; or when it asks, unless all do.
      const lowercase = all.every(found => /^\p{Ll}/u.test(say(found.phrase.words)));
      const numbered = new Set(all.flatMap(found => found.phrase.words.map(word => word.text).filter(text => /^\d+$/.test(text)))).size > 1;
      const outer = found => found.phrase.words[side === 'right' ? found.phrase.words.length - 1 : 0].text;
      for (const box of group.filter(item => !mixed.includes(item))) {
        const found = box[side], words = found?.phrase.words, rest = all.filter(item => item !== found);
        if (!found) { out[box.index] = {}; continue; }
        const most = Math.max(...rest.map(item => count(item.phrase.words))), gaps = rest.map(item => item.gap).filter(gap => gap > 0);
        const cut = n => [say(side === 'right' ? words.slice(0, n) : words.slice(-n)), say(words)];
        const doubt = found.own === 'shared' && votes.length ? readings(box, group) : usual(words) ? null
          : rest.length && count(words) > most ? cut(most)
          : box === end && count(words) > 1 && !rest.some(item => alike(outer(item), outer(found))) ? cut(count(words) - 1)
          : box === end && gaps.length && found.gap > 2 * Math.max(...gaps) && found.gap >= Math.max(...gaps) + unit / 2
            ? readings(box, group)
          : capitalised(words) && !rest.some(item => capitalised(item.phrase.words)) ? [say(words)]
          : QUESTION.test(lastWord(found.phrase)) && !prompt(found) && !all.every(item => QUESTION.test(lastWord(item.phrase)))
            ? [say(words)] : null;
        give(box, found, { doubt, lowercase, numbered, end: box === end });
      }
    }

    // A box alone: its caption is the phrase beside it; with words on both sides that ask nothing (read or not) it is
    // unsure. A list's number alone is none; a question or a field's prompt is its caption only when nothing else is
    // beside it and no phrase of its own is over it: after a question, a box whose right holds another question, another
    // field's prompt or a note in brackets is unsure ("Member? [ ] Number: ___", "Paid? [ ] (optional)"). It is unsure
    // when its phrase is about as near another box, is an answer of two words or more after a question or a prompt of
    // two words or more, has a capitalised word after its first, or has no letter (a price or a number alone may be an
    // answer code).
    function lone(box) {
      const { left, right } = box, beside = found => Boolean(found) && !asking(found);
      const listed = found => found.phrase.words.length === 1 && LIST.test(found.phrase.words[0].text);
      const note = found => /^\(/.test(found.phrase.words[0].text) && /\)$/.test(found.phrase.words[found.phrase.words.length - 1].text);
      const crowded = left && right && !listed(left) && !listed(right) && !said(left) && (!said(right) || note(right));
      if ((beside(left) && beside(right)) || crowded) { out[box.index] = { unsure: readings(box, [box]) }; return; }
      const found = said(right) ? right : said(left) ? left : right || left, words = found?.phrase.words || [];
      if (!found || (words.length === 1 && LIST.test(words[0].text))) { out[box.index] = {}; return; }
      if (!said(found) && box.head) { out[box.index] = { unsure: [say(words), say(box.head.words)] }; return; }
      const many = count(words) > 1;
      const doubt = found.own === 'shared' || (found === right && left && asks(left.phrase) && many) || (prompt(found) && many)
        || (said(found) && capitalised(words)) || !/\p{L}/u.test(say(words));
      give(box, found, { doubt: doubt ? [say(words)] : null, end: true });
    }

    // A box's caption, from its phrase: nothing readable, else unsure (with up to three readings) when a note or another
    // phrase may be in it or run on from it, or the reader may have misread it; else its words. `doubt`: the question's
    // own reason; `end`: the caption ends its question, so may run on to the next text row.
    function give(box, found, { doubt = null, lowercase = false, numbered = false, end = false }) {
      const { phrase, side } = found, words = phrase.words, text = say(words), note = noteBefore(text), noted = noteAt(words);
      if (phrase.faint === 'all') { out[box.index] = {}; return; }
      // Words in smaller print (a measured word less than 0.88 as tall as the tallest), or raised (at most 0.7 as tall as
      // the word before it, its foot a quarter of a text height higher): a note or a footnote's mark.
      const tallest = Math.max(...words.filter(measured).map(high));
      const small = words.filter((word, at) => (measured(word) && high(word) < 0.88 * tallest)
        || (at > 0 && high(word) <= 0.7 * high(words[at - 1]) && words[at - 1].bbox.y1 - word.bbox.y1 >= unit / 4));
      // Run on: the next phrase out is close (after the colon of "Plan A:", or a little more than a word space away, and
      // asks nothing), or the words reach another line of boxes; or the text row under it may carry it on, a phrase of it
      // that begins nothing of its own: one that starts under it or its box and is no box's own; one that starts before
      // its line's first box and asks nothing, when it ends its line on the right (a caption wrapped to the margin, or to
      // a question's indent); or, when it ends its question on its side and its line, one that reaches under it (on the
      // left, over it too), is no heading in capitals nor a question or a field's prompt, and over it ends no sentence.
      const close = found.beyond && (QUESTION.test(lastWord(phrase)) || (found.spaces <= space.wide && !asks(found.beyond)));
      const span = side === 'right' ? [box.sq.x0, phrase.x1] : [phrase.x0, box.sq.x1], beyond = found.beyond?.words || [];
      const carries = (item, above) => item.x1 > span[0] && item.x0 < span[1] && item.words.some(word => /\p{Ll}/u.test(word.text))
        && !QUESTION.test(lastWord(item)) && !(above && /[.!?)\]]["']*$/.test(lastWord(item)));
      const last = !found.beyond && !(side === 'right' ? found.each.to : found.each.from), edge = line[0].sq.x0 + unit / 2;
      const under = item => item.x0 >= span[0] - unit / 2 && item.x0 <= span[1] && !begins(item, true);
      const wraps = item => item.x0 <= edge && !asks(item) && !begins(item, false);
      const row = rowNear(words, true, ...span, true).find(under)
        || (side === 'right' && last && rowNear(words, true, -Infinity, edge, true).find(wraps))
        || (end && last && (rowNear(words, true, ...span).find(item => carries(item, false))
          || (side === 'left' && rowNear(words, false, ...span).find(item => carries(item, true)))));
      const reason = [
        note && [note, text],
        phrase.led > 0 && [say(words.slice(0, phrase.led)), text],
        noted > 0 && [say(words.slice(0, noted)), text],
        // An "I" the reader may have read as "1", "|" or "l" (when its question's captions hold two numbers or more, a
        // "1" is a number), then a code or a price.
        oneOrI(words) && !(numbered && words.every((word, at) => !doubtfulI(word, words[at + 1]) || word.text === '1'))
          && [say(withoutI(words)), say(asI(words))],
        coded(words) && [say(words.filter(word => !ANSWER(word.text) && !PRICE.test(word.text))), text],
        doubt,
        small.length > 0 && [say(words.filter(word => !small.includes(word))), text],
        (close || strays(phrase)) && [text, say(side === 'right' ? [...words, ...beyond] : [...beyond, ...words])],
        row && [text, say(row.words[0].bbox.y0 > words[0].bbox.y0 ? [...words, ...row.words] : [...row.words, ...words])],
        // Its last word joins what follows: the rest of it is elsewhere.
        words.length > 1 && GLUE.test(lastWord(phrase)) && [text],
        // The reader may have misread it otherwise: the square read into it, a "|" before it or between its words, words
        // it was unsure of, or a first word in small letters (a lost first word) unless all the captions of its question
        // begin so.
        words.some(word => word.squared) && [text],
        phrase.barred && [text, 'I ' + text],
        words.some((word, at) => at > 0 && at < words.length - 1 && word.text === '|') && [text],
        (phrase.faint || (/^\p{Ll}/u.test(text) && !LIST.test(words[0].text) && !lowercase)) && [text],
      ].find(Boolean);
      out[box.index] = reason ? { unsure: reason } : { words };
    }

    // A headed line: a box is named by its own phrase over it only when the line has two boxes or more (over a box alone,
    // "Tick" may be over a question's box), every box of it has its own phrase centred over it, holding no instruction's
    // word, code, price or note after its first word, and beginning, as all of them, with a capital or a small letter
    // ("Tick" / "one" is one instruction), and none has words of its own beside it, and its phrase asks nothing, holds no
    // note's sign and has no other row just over it, and no box of another line is in its column just over that phrase
    // or under the box (a column's heading, or words printed under a box); else it is unsure.
    function headed() {
      const plain = words => !words.some(word => INSTRUCTION.has(word.text.toLowerCase())) && !coded(words) && noteAt(words) < 0;
      const small = box => /^\p{Ll}/u.test(say(box.head.words));
      const bare = line.length > 1 && line.every(box => box.head && centred(box) && !said(box.left) && !said(box.right)
        && plain(box.head.words) && small(box) === small(line[0]));
      for (const box of line) {
        const head = box.head, text = head && say(head.words), top = head && Math.min(...head.words.map(word => word.bbox.y0));
        const named = bare && !QUESTION.test(lastWord(head)) && !noteBefore(text)
          && !rowNear(head.words, false, head.x0, head.x1).length && !column(box, top - unit * 4, top).length
          && !column(box, box.sq.y1, box.sq.y1 + unit * 4).length;
        const list = [...readings(box, line), ...(text ? [text] : [])];
        out[box.index] = named ? { above: text } : list.length ? { unsure: list } : {};
      }
    }
  }
}

// Every blank's label, for one page. `words` are the page reader's words ({ text, confidence, bbox, symbols? }), all of
// them: which to use is decided here. A checkbox is named by its caption (above); a checkbox that cannot be told gets
// label '' and `unsure`, the words it might be; every other blank as before (labelFor).
export function labelBlanks(blanks, words, unit = 20) {
  // Blanks that are not checkboxes are labelled exactly as before, from the words the reader was over 50% sure of.
  // Words the reader was unsure of that touch no square are no caption, but they are there: a caption the reader could
  // not read is not passed over to reach other words (nor is a joining sign: "Yes / Si"). So is a word no line of text
  // could be: over two and a half text heights tall or under a third of one. A dot leader holds the words it runs
  // between together ("Adult ticket ........ $25 [ ]"), and so does a sign between two words ("18 – 24").
  const squares = blanks.filter(blank => blank.kind === 'check').map(square), near = nearSquares(squares);
  const odd = word => high(word) > unit * 2.5 || high(word) < unit / 3, apart = word => !touchingOf(near(word.bbox), word.bbox).length;
  const asWord = word => ({ text: String(word.text).trim(), confidence: word.confidence, bbox: word.bbox });
  const read = words.flatMap(leaderOff);
  const faint = read.filter(word => !sure(word) && (lettered(String(word.text || '')) || /^[/&+]$/.test(String(word.text || '').trim()))
    && !DOTS(word.text) && apart(word)).map(word => ({ ...asWord(word), faint: true }));
  const leaders = read.filter(word => DOTS(word.text) && apart(word)).map(word => ({ ...asWord(word), leader: true }));
  const links = read.filter(word => LINK.test(String(word.text || '').trim()) && apart(word))
    .map(word => ({ ...asWord(word), link: true, ...(sure(word) ? {} : { faint: true }) }));
  const clean = pieces(blanks, read).filter(word => !DOTS(word.text) && !LINK.test(word.text))
    .map(word => odd(word) ? { ...word, faint: true } : word);
  const plain = words.filter(sure), named = captions(blanks, [...clean, ...faint, ...leaders, ...links], unit);
  return blanks.map((blank, index) => {
    const { unsure, ...rest } = blank;
    if (blank.kind !== 'check') return { ...rest, label: labelFor(blank, plain, unit) };
    const found = named[index], readings = [...new Set((found.unsure || []).filter(Boolean))].slice(0, 3);
    if (readings.length) return { ...rest, label: '', unsure: readings };
    return { ...rest, label: found.words ? say(found.words) : found.above || '' };
  });
}

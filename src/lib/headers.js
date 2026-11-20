// Table headers as labels for the cells under them.
//
// A table's body cells are found as empty boxes, and the page's full read of a form does not return the words in a
// ruled header row, so a cell under a header was called "blank". Here each column's header cell is read on its own,
// twice: as it is, and from a copy enlarged twofold. The cells under it are labelled with the header only when the
// two reads say the same, letter for letter, but for the misreads a reader makes of the same letters ("[tem" for
// "Item", "N0." for "No."), and the first read is at least 60% sure of every word. Anything else leaves the cells
// unlabelled: a wrong label is worse than none, since labels decide where a CSV column and your details go. A cell
// labelled from its header says so (column: true), and your details never fill it (see profile.js).
import { threshold } from './blanks.js';

const SURE = 60;
// The letter a reader misreads as each of these: "[" "|" and "l" for "I", "0" for "O" (or "o").
const MISREAD = { I: ['[', '|', 'l'], O: ['0'], o: ['0'] };
const misreadAs = (proper, seen) => (MISREAD[proper] || []).includes(seen);

// A read as one line of text, its words in order, a trailing colon dropped; and how sure the reader was of its least
// sure word (0 for no words).
const textOf = read => (read?.words || []).map(word => String(word.text ?? '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/\s*:+$/, '').trim();
const leastOf = read => { const words = (read?.words || []).filter(word => String(word.text ?? '').trim()); return words.length ? Math.min(...words.map(word => Number(word.confidence) || 0)) : 0; };

// The header two reads agree on, or '' when they do not. Where the texts differ only at letters the reader may have
// misread, the proper letter is taken from whichever read has it; any other difference, a first read under 60% sure,
// or a text with no letter, digit or "#" leaves the column unlabelled.
export function headerLabel(first, second) {
  const one = textOf(first), two = textOf(second), sure = leastOf(first);
  const report = label => ({ label, first: { text: one, confidence: leastOf(first) }, second: { text: two, confidence: leastOf(second) } });
  if (!one || sure < SURE || !/[\p{L}\p{N}#]/u.test(one) || [...one].length !== [...two].length) return report('');
  const a = [...one], b = [...two], merged = [];
  for (let at = 0; at < a.length; at++) {
    if (a[at] === b[at]) merged.push(a[at]);
    else if (misreadAs(a[at], b[at])) merged.push(a[at]);
    else if (misreadAs(b[at], a[at])) merged.push(b[at]);
    else return report('');
  }
  return report(merged.join(''));
}

// A part of the page as its own picture, each pixel made scale x scale, with a margin of paper round it.
export function cropOf(gray, width, height, box, scale = 1, margin = 8) {
  const x0 = Math.max(0, Math.round(box.x0)), y0 = Math.max(0, Math.round(box.y0)), x1 = Math.min(width, Math.round(box.x1)), y1 = Math.min(height, Math.round(box.y1));
  const w = (x1 - x0) * scale + 2 * margin, h = (y1 - y0) * scale + 2 * margin, out = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < (y1 - y0) * scale; y++) for (let x = 0; x < (x1 - x0) * scale; x++) out[(y + margin) * w + x + margin] = gray[(y0 + Math.floor(y / scale)) * width + x0 + Math.floor(x / scale)];
  return { gray: out, width: w, height: h };
}

// The header cell over each column of a table's cells, with the cells under it: [{ cell, blanks: [indexes] }]. A
// column is boxes with the same sides, one under the next (its top cell may already carry the header's words, where
// the page's read reached them). Its header cell is the row above its top box, closed by a rule over it and by the
// column's own walls on both sides, with ink inside: a header that spans several columns, a table with open sides and
// a header row with no rule over it give none.
export function headerCells(gray, width, height, blanks) {
  const unit = Math.max(10, Math.round(height / 45)), tol = Math.max(4, Math.round(unit * 0.4)), inset = Math.max(4, Math.round(unit * 0.15));
  const candidates = blanks.map((blank, index) => ({ blank, index })).filter(({ blank }) => blank.kind === 'box' && !blank.field && !blank.unsure);
  if (!candidates.length) return [];
  const ink = threshold(gray, width, height), dark = (x, y) => x >= 0 && y >= 0 && x < width && y < height && ink[y * width + x] === 1;
  // How much of a row of pixels across the column (or of a column of pixels down the band) is ink. A rule or a wall
  // is ink nearly all the way; a row through letters is not.
  const across = (y, x0, x1) => { let count = 0; for (let x = x0; x <= x1; x++) if (dark(x, y)) count++; return count / (x1 - x0 + 1); };
  const down = (x, y0, y1) => { let count = 0; for (let y = y0; y <= y1; y++) if (dark(x, y)) count++; return count / (y1 - y0 + 1); };
  const columns = [];
  for (const item of candidates.sort((a, b) => a.blank.x0 - b.blank.x0 || a.blank.y0 - b.blank.y0)) {
    const column = columns.find(group => Math.abs(group.x0 - item.blank.x0) <= tol && Math.abs(group.x1 - item.blank.x1) <= tol);
    if (column) column.items.push(item); else columns.push({ x0: item.blank.x0, x1: item.blank.x1, items: [item] });
  }
  const found = [];
  for (const column of columns) {
    // One under the next: a gap of more than a line between two boxes starts another table.
    const stacks = [];
    for (const item of column.items.sort((a, b) => a.blank.y0 - b.blank.y0)) {
      const last = stacks.at(-1)?.at(-1);
      if (last && item.blank.y0 - last.blank.y1 <= unit) stacks.at(-1).push(item); else stacks.push([item]);
    }
    for (const stack of stacks) {
      const top = stack[0].blank, x0 = Math.round(top.x0), x1 = Math.round(top.x1);
      // The rule over the top box, then the rule over the row above it, at least 0.6 of a line higher (the finder's
      // shortest cell) and at most five lines higher (a header in two or three lines).
      let rule = -1;
      for (let y = Math.round(top.y0) - 1; y >= Math.max(0, Math.round(top.y0) - unit); y--) if (across(y, x0, x1) >= 0.85) { rule = y; break; }
      if (rule < 0) continue;
      while (rule > 0 && across(rule - 1, x0, x1) >= 0.85) rule--;
      let over = -1;
      for (let y = rule - Math.round(unit * 0.6); y >= Math.max(0, rule - unit * 5); y--) if (across(y, x0, x1) >= 0.85) { over = y; break; }
      if (over < 0) continue;
      const band = { y0: over + 1, y1: rule - 1 };
      // The column's walls go on up through the row: there is a wall beside both of its sides.
      const wall = (from, to) => { for (let x = from; x <= to; x++) if (down(x, band.y0 + 2, band.y1 - 2) >= 0.85) return true; return false; };
      if (!wall(x0 - inset - 3, x0 - 1) || !wall(x1 + 1, x1 + inset + 3)) continue;
      const cell = { x0, y0: band.y0 + 2, x1, y1: band.y1 - 2 };
      let count = 0;
      for (let y = cell.y0; y < cell.y1; y++) for (let x = cell.x0; x < cell.x1; x++) if (dark(x, y)) count++;
      if (count < Math.max(20, Math.round(unit * unit * 0.02))) continue;
      found.push({ cell, blanks: stack.map(item => item.index) });
    }
  }
  return found;
}

// The page's blanks, the cells under a header that reads the same twice labelled with it (label: the header, column:
// true); every other blank as it was, but for one: the page's read can reach a header, or part of it, from the
// column's top cell (its label is then the header's words, all or some of them: "price" for "Unit price"), and such
// a label becomes the header, or nothing when the header does not read the same twice. A cell with words of its own
// (a row's label) keeps them. recognize(gray, width, height) reads a small picture as a
// block of text (Tesseract's page segmentation mode 6) and gives { words: [{ text, confidence }] }. onRead, if given,
// hears each header cell's two reads and what was made of them. unit is the page's text height, as labelBlanks gets
// it; the header cells are found by the page's own measure, as the blanks are.
export async function headerLabels(gray, width, height, blanks, unit, recognize, { onRead } = {}) {
  const out = blanks.map(blank => ({ ...blank })), keyOf = text => String(text || '').toLowerCase().replace(/[[|l]/g, 'i').replace(/0/g, 'o').replace(/[^\p{L}\p{N}#]/gu, '');
  for (const { cell, blanks: under } of headerCells(gray, width, height, blanks)) {
    const read = scale => { const picture = cropOf(gray, width, height, cell, scale); return recognize(picture.gray, picture.width, picture.height); };
    const first = await read(1), second = await read(2), made = headerLabel(first, second);
    onRead?.({ cell, blanks: under, ...made });
    const header = [made.label, made.first.text, made.second.text].map(keyOf).filter(Boolean);
    for (const [at, index] of under.entries()) {
      // The header's words: the whole header in any cell; in the top cell, which the page's read reaches from below,
      // also a part of it.
      const own = out[index].label, key = keyOf(own), its = Boolean(own) && Boolean(key) && header.some(text => text === key || (at === 0 && text.includes(key)));
      if (made.label && (!own || its)) out[index] = { ...out[index], label: made.label, column: true };
      else if (!made.label && its) out[index] = { ...out[index], label: '' };
    }
  }
  return out;
}

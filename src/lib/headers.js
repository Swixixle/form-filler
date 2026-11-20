// Table headers as labels for the cells under them.
//
// A table's body cells are found as empty boxes, and the page's full read of a form does not return the words in a
// ruled header row, so a cell under a header was called "blank". Here each column's header cell is read on its own,
// twice: as it is, and from a copy enlarged twofold. The cells under it are labelled with the header only when the
// two reads say the same, letter for letter, but for the misreads a reader makes of the same letters ("[tem" for
// "Item", "N0." for "No."), and the first read is at least 60% sure of every word. Anything else leaves the cells
// unlabelled: a wrong label is worse than none, since labels decide where a CSV column and your details go. A cell
// labelled from its header says so (column: true), and your details never fill it (see profile.js). Two reads can
// still agree on the same misreading ("Ibs" for "lbs"); nothing here can tell.
import { threshold } from './blanks.js';

const SURE = 60;
const letter = ch => /\p{L}/u.test(ch || ''), digit = ch => /\p{N}/u.test(ch || ''), lower = ch => /\p{Ll}/u.test(ch || ''), upper = ch => /\p{Lu}/u.test(ch || '');
// A place where two reads of the same header differ: the letter it is, told by its neighbours in the first read, or
// null when they cannot tell. "[" and "|" are never letters, so the other read's "I" stands. Between "l" and "I": an
// "l" after a small letter ("TotaI" is "Total"), an "I" in a word of capitals ("lD" is "ID"); at the start of a word
// before a small letter it could be either ("ltem", "Ibs"), and is not guessed. Between "0" and "O": a "0" beside a
// digit ("Box 1O" is "Box 10"), the letter beside a letter ("N0." is "No.").
function misread(a, b, at) {
  const pair = new Set([a[at], b[at]]), before = a[at - 1], after = a[at + 1];
  if (pair.has('I') && (pair.has('[') || pair.has('|'))) return 'I';
  if (pair.has('I') && pair.has('l')) return lower(before) ? 'l' : upper(before) || upper(after) ? 'I' : null;
  const o = [...pair].find(ch => ch === 'O' || ch === 'o');
  if (o && pair.has('0')) return digit(before) || digit(after) ? '0' : letter(before) || letter(after) ? o : null;
  return null;
}

// A read as one line of text, its words in order, a trailing colon dropped; and how sure the reader was of its least
// sure word (0 for no words).
const textOf = read => (read?.words || []).map(word => String(word.text ?? '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/\s*:+$/, '').trim();
const leastOf = read => { const words = (read?.words || []).filter(word => String(word.text ?? '').trim()); return words.length ? Math.min(...words.map(word => Number(word.confidence) || 0)) : 0; };

// The header two reads agree on, or '' when they do not. Where the texts differ only at letters the reader may have
// misread, the letter is told by its neighbours (above); any other difference, a place the neighbours cannot tell, a
// "[" or "|" left in the text, a first read under 60% sure of any word, or a text with no letter, digit or "#" leaves
// the column unlabelled.
export function headerLabel(first, second) {
  const one = textOf(first), two = textOf(second), sure = leastOf(first);
  const report = label => ({ label, first: { text: one, confidence: leastOf(first) }, second: { text: two, confidence: leastOf(second) } });
  if (!one || sure < SURE || !/[\p{L}\p{N}#]/u.test(one) || [...one].length !== [...two].length) return report('');
  const a = [...one], b = [...two], merged = [];
  for (let at = 0; at < a.length; at++) {
    const got = a[at] === b[at] ? a[at] : misread(a, b, at);
    if (!got) return report('');
    merged.push(got);
  }
  return report(/[[|]/.test(merged.join('')) ? '' : merged.join(''));
}

// A part of the page as its own picture, each pixel made scale x scale, with a margin of paper round it.
export function cropOf(gray, width, height, box, scale = 1, margin = 8) {
  const x0 = Math.max(0, Math.round(box.x0)), y0 = Math.max(0, Math.round(box.y0)), x1 = Math.min(width, Math.round(box.x1)), y1 = Math.min(height, Math.round(box.y1));
  const w = (x1 - x0) * scale + 2 * margin, h = (y1 - y0) * scale + 2 * margin, out = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < (y1 - y0) * scale; y++) for (let x = 0; x < (x1 - x0) * scale; x++) out[(y + margin) * w + x + margin] = gray[(y0 + Math.floor(y / scale)) * width + x0 + Math.floor(x / scale)];
  return { gray: out, width: w, height: h };
}

// The header cell over each column of a table, with the cells under it: [{ cell, blanks: [indexes] }]. A column is
// two or more empty boxes with the same sides, each only a rule below the last: a box with ink in it is a header or a
// cell with words, not one of them, and a single box under a caption is a form's field, not a table's column. The
// column's top cell may already carry the header's words, where the page's read reached them. Its header cell is the
// row above its top box: closed by a rule over it and by the column's own walls on both sides, with the walls not
// going on up above it (then it is a row of the table, filled in, and not its header), and with ink inside. A header
// that spans several columns, a table with open sides and a header row with no rule over it give none. The cell read
// runs out to the inner edge of each wall, so a cramped header's letters are not cut.
export function headerCells(gray, width, height, blanks) {
  const unit = Math.max(10, Math.round(height / 45)), tol = Math.max(4, Math.round(unit * 0.4)), inset = Math.max(4, Math.round(unit * 0.15));
  const enough = Math.max(20, Math.round(unit * unit * 0.02));
  const candidates = blanks.map((blank, index) => ({ blank, index })).filter(({ blank }) => blank.kind === 'box' && !blank.field && !blank.unsure);
  if (candidates.length < 2) return [];
  const ink = threshold(gray, width, height), dark = (x, y) => x >= 0 && y >= 0 && x < width && y < height && ink[y * width + x] === 1;
  const inkIn = box => { let count = 0; for (let y = Math.round(box.y0); y < Math.round(box.y1); y++) for (let x = Math.round(box.x0); x < Math.round(box.x1); x++) if (dark(x, y)) count++; return count; };
  // How much of a row of pixels across the column (or of a column of pixels down the band) is ink. A rule or a wall
  // is ink nearly all the way; a row through letters is not.
  const across = (y, x0, x1) => { let count = 0; for (let x = x0; x <= x1; x++) if (dark(x, y)) count++; return count / (x1 - x0 + 1); };
  const down = (x, y0, y1) => { if (y1 < y0) return 0; let count = 0; for (let y = y0; y <= y1; y++) if (dark(x, y)) count++; return count / (y1 - y0 + 1); };
  // The first column of wall from `from` towards `to`, between two heights, or null.
  const wallAt = (from, to, y0, y1) => { const step = to >= from ? 1 : -1; for (let x = from; step > 0 ? x <= to : x >= to; x += step) if (down(x, y0, y1) >= 0.85) return x; return null; };
  const columns = [];
  for (const item of candidates.sort((a, b) => a.blank.x0 - b.blank.x0 || a.blank.y0 - b.blank.y0)) {
    const column = columns.find(group => Math.abs(group.x0 - item.blank.x0) <= tol && Math.abs(group.x1 - item.blank.x1) <= tol);
    if (column) column.items.push(item); else columns.push({ x0: item.blank.x0, x1: item.blank.x1, items: [item] });
  }
  const found = [];
  for (const column of columns) {
    // Each under the last with only a rule between (two insets and a rule's width): a caption row between two boxes,
    // or a box with ink in it, starts another stack.
    const stacks = [[]];
    for (const item of column.items.sort((a, b) => a.blank.y0 - b.blank.y0)) {
      if (inkIn(item.blank) >= enough) { stacks.push([]); continue; }
      const last = stacks.at(-1).at(-1);
      if (last && item.blank.y0 - last.blank.y1 > 2 * inset + 8) stacks.push([]);
      stacks.at(-1).push(item);
    }
    for (const stack of stacks.filter(cells => cells.length >= 2)) {
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
      // The column's walls go on up through the row, beside both of its sides; and not both on up above it.
      const left = wallAt(x0 - 1, x0 - inset - 3, band.y0 + 2, band.y1 - 2), right = wallAt(x1 + 1, x1 + inset + 3, band.y0 + 2, band.y1 - 2);
      if (left === null || right === null) continue;
      const above = Math.max(0, over - Math.round(unit * 0.6));
      if (over - above > 3 && wallAt(x0 - 1, x0 - inset - 3, above, over - 3) !== null && wallAt(x1 + 1, x1 + inset + 3, above, over - 3) !== null) continue;
      const cell = { x0: left + 2, y0: band.y0 + 2, x1: right - 1, y1: band.y1 - 2 };
      if (cell.x1 - cell.x0 < 4 || cell.y1 - cell.y0 < 4 || inkIn(cell) < enough) continue;
      found.push({ cell, blanks: stack.map(item => item.index) });
    }
  }
  return found;
}

// The page's blanks, the cells under a header that reads the same twice labelled with it (label: the header, column:
// true); every other blank as it was, but for one: the page's read can reach a header from the column's top cell
// and give that cell the header's words, all or some of them ("price" for "Unit price"). Such a label (whole words of
// the header) becomes the header, or nothing when the header does not read the same twice. Any other label a cell
// has (a row's label: "AM", "Total") is its own and kept. recognize(gray, width, height) reads a small picture as a
// block of text (Tesseract's page segmentation mode 6) and gives { words: [{ text, confidence }] }. onRead, if given,
// hears each header cell's two reads and what was made of them. unit is the page's text height, as labelBlanks gets
// it; the header cells are found by the page's own measure, as the blanks are.
export async function headerLabels(gray, width, height, blanks, unit, recognize, { onRead } = {}) {
  const out = blanks.map(blank => ({ ...blank }));
  const keyOf = text => String(text || '').toLowerCase().replace(/[[|l]/g, 'i').replace(/0/g, 'o').replace(/[^\p{L}\p{N}#]/gu, '');
  const wordsOf = text => String(text || '').split(/\s+/).map(keyOf).filter(Boolean);
  const runIn = (whole, part) => part.length > 0 && whole.some((_, at) => part.every((word, k) => whole[at + k] === word));
  for (const { cell, blanks: under } of headerCells(gray, width, height, blanks)) {
    const read = scale => { const picture = cropOf(gray, width, height, cell, scale); return recognize(picture.gray, picture.width, picture.height); };
    const first = await read(1), second = await read(2), made = headerLabel(first, second);
    onRead?.({ cell, blanks: under, ...made });
    const reads = [made.label, made.first.text, made.second.text].map(wordsOf).filter(words => words.length);
    under.forEach((index, at) => {
      const own = out[index].label, its = at === 0 && Boolean(own) && reads.some(words => runIn(words, wordsOf(own)));
      if (made.label && (!own || its)) out[index] = { ...out[index], label: made.label, column: true };
      else if (!made.label && its) out[index] = { ...out[index], label: '' };
    });
  }
  return out;
}

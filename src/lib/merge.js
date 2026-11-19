// A mail merge: one filled copy of a form for each row of a spreadsheet (saved as CSV). Each column goes to the blank
// it names: by its number ("3", "#3", "blank 3"), by the PDF field's own name, or by the blank's label ("Name",
// "Serial number"). Columns that name no blank are reported, never guessed at.
import { TICK } from './answers.js';

// RFC 4180 CSV: commas, quotes ("" inside quotes is a quote), new lines inside quotes, a byte-order mark at the start.
export function parseCsv(text) {
  const source = String(text).replace(/^﻿/, ''), rows = [];
  let row = [], cell = '', quoted = false;
  for (let at = 0; at < source.length; at++) {
    const char = source[at];
    if (quoted) {
      if (char === '"') { if (source[at + 1] === '"') { cell += '"'; at++; } else quoted = false; } else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') { if (char === '\r' && source[at + 1] === '\n') at++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) throw new Error('The CSV has a quote that is never closed.');
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(item => item.some(value => value.trim() !== ''));
}

const norm = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// For each column, the blank index it fills (or null), and the columns that matched nothing.
export function matchColumns(blanks, headers) {
  const byLabel = new Map();
  blanks.forEach((blank, index) => { const key = norm(blank.label); if (key) byLabel.set(key, [...(byLabel.get(key) || []), index]); });
  // A label two blanks share matches neither (-1), with one exception: a checkbox and the line its caption names
  // ("[ ] Other: ____"), where the column goes to the line, as it did before checkboxes were named by their captions.
  const target = key => {
    const found = byLabel.get(key), others = (found || []).filter(index => blanks[index].kind !== 'check');
    return !found ? undefined : found.length === 1 ? found[0] : found.length === 2 && others.length === 1 ? others[0] : -1;
  };
  const columns = headers.map(header => {
    const text = String(header).trim(), number = text.match(/^(?:#|blank\s*)?(\d{1,3})$/i);
    if (number) { const index = Number(number[1]) - 1; return index >= 0 && index < blanks.length ? index : null; }
    const field = blanks.findIndex(blank => blank.field && blank.field === text);
    if (field >= 0) return field;
    const label = target(norm(text));
    return label === undefined || label < 0 ? null : label;
  });
  const unmatched = headers.filter((_, index) => columns[index] === null);
  const shared = headers.filter(header => target(norm(header)) === -1);
  return { columns, unmatched, shared };
}

// One row's values, one per blank, on top of `base` (what every copy shares, such as today's date).
export function rowValues(blanks, columns, row, base = []) {
  const values = blanks.map((blank, index) => base[index] ?? (blank.kind === 'check' ? false : ''));
  columns.forEach((index, column) => {
    if (index === null || index === undefined) return;
    const cell = String(row[column] ?? '').trim();
    values[index] = blanks[index].kind === 'check' ? TICK.test(cell) || /^(?:true|1|on)$/i.test(cell) : cell;
  });
  return values;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import * as lib from '../src/lib/index.js';
import { ROWS as CURATED, LIMITS as CURATED_LIMITS } from './caption-rows.js';

// Checkbox labels. The pages are invented (tests/fixtures; drawn by scripts/make-fixtures.py and
// scripts/make-checkbox-fixture.mjs) and their words are what the page's reader returns for them, stored by
// scripts/make-word-fixtures.mjs, so these tests need no reader.
const fixture = name => new URL('./fixtures/' + name, import.meta.url);
function page(name) {
  const png = PNG.sync.read(readFileSync(fixture(name + '.png'))), { width, height } = png;
  let gray = new Uint8Array(width * height);
  for (let at = 0; at < gray.length; at++) gray[at] = Math.round(0.299 * png.data[at * 4] + 0.587 * png.data[at * 4 + 1] + 0.114 * png.data[at * 4 + 2]);
  const angle = lib.skewOf(gray, width, height);
  if (Math.abs(angle) >= 0.2) gray = lib.rotate(gray, width, height, angle);
  const { words } = JSON.parse(readFileSync(fixture(name + '-words.json'), 'utf8'));
  // The text size the page uses: the middle height of the words the reader was over 50% sure of.
  const heights = words.filter(word => word.confidence > 50).map(word => word.bbox.y1 - word.bbox.y0).sort((a, b) => a - b), unit = heights[Math.floor(heights.length / 2)];
  const blanks = lib.findBlanks(gray, width, height);
  return { blanks, words, unit, labelled: lib.labelBlanks(blanks, words, unit) };
}
const FORMS = ['form', 'form-photo', 'form-webkit'];   // the invented form as drawn, as a crooked phone photo, as WebKit draws its PDF

test('the invented form, in all three renderings: the box beside "Day" is labelled Day, the box beside "Night" Night, and no other label changes', () => {
  for (const name of FORMS) {
    const { blanks, words, unit, labelled } = page(name);
    assert.deepEqual(labelled.map(blank => blank.kind), ['line', 'line', 'line', 'box', 'box', 'box', 'box', 'box', 'box', 'check', 'check', 'box', 'line'], name);
    assert.equal(labelled[9].label, 'Day', name); assert.equal(labelled[10].label, 'Night', name);
    assert.ok(labelled.every(blank => !blank.unsure), name + ': nothing is unclear');
    // Everything that is not a checkbox is labelled as 2.2.0 labelled it.
    const before = blanks.map(blank => lib.labelFor(blank, words.filter(word => word.confidence > 50), unit));
    labelled.forEach((blank, index) => { if (blank.kind !== 'check') assert.equal(blank.label, before[index], name + ', blank ' + (index + 1)); });
  }
});

test('a CSV column "Day" ticks the Day box and nothing else; "Night" ticks the Night box', () => {
  for (const name of FORMS) {
    const { labelled } = page(name), { columns, unmatched } = lib.matchColumns(labelled, ['Day', 'Night']);
    assert.deepEqual(columns, [9, 10], name); assert.deepEqual(unmatched, [], name);
    const day = lib.rowValues(labelled, columns, ['x', '']), night = lib.rowValues(labelled, columns, ['', 'yes']);
    assert.deepEqual([day[9], day[10]], [true, false], name + ': the Day column');
    assert.deepEqual([night[9], night[10]], [false, true], name + ': the Night column');
  }
});

test('the checkbox sheet: a caption on either side of a box, a Yes/No pair on one line both ways round, long captions, and a box that cannot be told', () => {
  const { labelled } = page('checkboxes');
  // Name; [ ] Yes; Yes [ ]; locker [ ] Yes [ ] No; parking Yes [ ] No [ ]; I agree to the house rules [ ];
  // [ ] I have read the notice; Unclear spacing: [ ] Maybe [ ].
  assert.deepEqual(labelled.map(blank => blank.label), ['Name', 'Yes', 'Yes', 'Yes', 'No', 'Yes', 'No', 'I agree to the house rules', 'I have read the notice', '', '']);
  // "Maybe" is as near to either box: neither is given it, both are marked unclear with it as the possible caption.
  assert.deepEqual(labelled.map(blank => blank.unsure ?? null), [null, null, null, null, null, null, null, null, null, ['Maybe'], ['Maybe']]);
  // So a CSV column "Maybe" ticks nothing; it is named as matching no blank.
  assert.deepEqual(lib.matchColumns(labelled, ['Maybe']).unmatched, ['Maybe']);
});

// Made-up rows of checkboxes and words (no picture, no reader): each a list of tokens laid left to right. '[]' is a
// checkbox, '___' a line to write on, a number a space in pixels, a string a word, an object a word placed by hand
// (`dx` from where it would go) with its own confidence and letters.
const UNIT = 26, CHAR = 14, SIDE = 28;
function row(...tokens) {
  const blanks = [], words = [], y = 100;
  let x = 100;
  for (const token of tokens) {
    if (typeof token === 'number') { x += token; continue; }
    if (token === '[]') { blanks.push({ kind: 'check', x0: x + 5, y0: y + 2, x1: x + SIDE - 5, y1: y + SIDE - 2 }); x += SIDE; continue; }
    if (token === '___') { blanks.push({ kind: 'line', x0: x, y0: y + SIDE - 72, x1: x + 300, y1: y + SIDE - 2 }); x += 300; continue; }
    if (typeof token === 'object') { words.push({ text: token.text, confidence: token.confidence ?? 90, bbox: { x0: x + token.dx, y0: y, x1: x + token.dx + token.text.length * CHAR, y1: y + UNIT }, ...(token.symbols ? { symbols: token.symbols(x + token.dx, y) } : {}) }); continue; }
    words.push({ text: token, confidence: 90, bbox: { x0: x, y0: y, x1: x + token.length * CHAR, y1: y + UNIT } }); x += token.length * CHAR;
  }
  return { blanks, words };
}
// Letters for a word laid at x: each CHAR wide, with the given confidences.
const letters = (text, confidences) => (x, y) => [...text].map((char, at) => ({ text: char, confidence: confidences[at] ?? 95, bbox: { x0: x + at * CHAR, y0: y, x1: x + (at + 1) * CHAR, y1: y + UNIT } }));
const labelsOf = ({ blanks, words }) => lib.labelBlanks(blanks, words, UNIT).map(blank => blank.unsure ? { unsure: blank.unsure } : blank.label);
const ROWS = [
  ['a caption on the right: "[ ] Yes"', row('Agree?', 60, '[]', 14, 'Yes'), ['Yes']],
  ['a caption on the left: "Yes [ ]"', row('Agree?', 60, 'Yes', 14, '[]'), ['Yes']],
  ['a Yes/No pair, captions on the right, after a question', row('Smoker?', 60, '[]', 14, 'Yes', 60, '[]', 14, 'No'), ['Yes', 'No']],
  ['a Yes/No pair, captions on the left, after a question', row('Smoker?', 60, 'Yes', 14, '[]', 60, 'No', 14, '[]'), ['Yes', 'No']],
  ['a pair after a question with ":", captions on the right', row('Shift:', 60, '[]', 14, 'Day', 60, '[]', 14, 'Night'), ['Day', 'Night']],
  ['the question touching the first box', row('Shift:', 3, '[]', 14, 'Day', 40, '[]', 14, 'Night'), ['Day', 'Night']],
  ['captions touching the boxes on the left', row('Yes', 2, '[]', 40, 'No', 2, '[]'), ['Yes', 'No']],
  ['two questions on one line, wide apart', row('Smoker', 40, '[]', 14, 'Yes', 40, '[]', 14, 'No', 120, 'Pets', 40, '[]', 14, 'Yes', 40, '[]', 14, 'No'), ['Yes', 'No', 'Yes', 'No']],
  ['even spacing, captions on the right', row('[]', 20, 'A', 20, '[]', 20, 'B', 20, '[]', 20, 'C'), ['A', 'B', 'C']],
  ['even spacing, captions on the left', row('A', 20, '[]', 20, 'B', 20, '[]', 20, 'C', 20, '[]'), ['A', 'B', 'C']],
  ['a lone box with its caption on the left and "?"', row('Escort', 10, 'needed?', 20, '[]'), ['Escort needed?']],
  ['a lone box, its caption on the left, a far word on its right', row('Escort', 10, 'needed', 20, '[]', 300, 'Notes'), ['Escort needed']],
  ['each box after its own question', row('Married?', 14, '[]', 30, 'Children?', 14, '[]'), ['Married?', 'Children?']],
  ['a question, a box, then an answer of several words: unclear, since the words after "Yes," may be a note', row('Newsletter?', 14, '[]', 14, 'Yes,', 10, 'send', 10, 'it'), [{ unsure: ['Yes', 'Yes, send it'] }]],
  ['captions on the right that are themselves questions', row('[]', 14, 'Need', 10, 'parking?', 40, '[]', 14, 'Need', 10, 'a', 10, 'ramp?'), ['Need parking?', 'Need a ramp?']],
  ['a list number before a box', row('1.', 14, '[]', 14, 'I', 10, 'agree'), ['I agree']],
  ['"|" read for "I"', row('[]', 14, '|', 10, 'agree'), ['I agree']],
  ['a box, its caption with ":", then a line', row('[]', 14, 'Other:', 12, '___'), ['Other', 'Other']],
  ['a box after "I agree", then "Date:" and a line', row('I', 10, 'agree', 14, '[]', 200, 'Date:', 12, '___'), ['I agree', 'Date']],
  ['a group whose captions are beside the boxes, one caption lost: that box stays unnamed, and "Night" is unclear', row('Shift:', 60, '[]', 60, '[]', 14, 'Night'), ['', { unsure: ['Night'] }]],
  ['captions printed above the boxes', (() => {
    const words = ['Mon', 'Tue', 'Wed'].map((text, at) => ({ text, confidence: 90, bbox: { x0: 100 + at * 120, y0: 100, x1: 100 + at * 120 + 42, y1: 126 } }));
    return { words, blanks: [0, 1, 2].map(at => ({ kind: 'check', x0: 100 + at * 120 + 5, y0: 142, x1: 100 + at * 120 + 23, y1: 166 })) };
  })(), ['Mon', 'Tue', 'Wed']],
  ['a box alone, no words', row('[]'), ['']],
  // The reader's words for the square itself, or a caption run into it.
  ['the reader ran the square into its caption: "[]Day"', row('[]', { text: '[]Day', dx: -SIDE }, 14 + 3 * CHAR, 60, '[]', 14, 'Night'), ['Day', 'Night']],
  ['a caption run into the square, unsure as a word but sure letter by letter: "[_]Mail"', row('Contact:', 14, '[]', { text: '[_]Mail', dx: -SIDE, confidence: 28, symbols: letters('[_]Mail', [97, 60, 96, 95, 96, 95, 96]) }, 14 + 4 * CHAR, 40, '[]', 14, 'Post'), ['Mail', 'Post']],
  ['two captions run together over a square: "Yes[]No"', row('Smoker?', 30, { text: 'Yes[]No', dx: 0, confidence: 45, symbols: (x, y) => [...letters('Yes', [99, 99, 99])(x, y), { text: '[', confidence: 90, bbox: { x0: x + 3 * CHAR + 4, y0: y, x1: x + 3 * CHAR + 16, y1: y + UNIT } }, { text: ']', confidence: 90, bbox: { x0: x + 3 * CHAR + 20, y0: y, x1: x + 3 * CHAR + 32, y1: y + UNIT } }, ...letters('No', [99, 99])(x + 3 * CHAR + 4 + SIDE + 4, y)] }, 3 * CHAR + 4, '[]', 4 + 2 * CHAR + 4, '[]'), ['Yes', 'No']],
  ['an unsure word touching no square is no caption', row('[]', 14, { text: 'VYAV', dx: 0, confidence: 40 }), ['']],
  ['a caption read with its letters, reaching 3 px into the next square\'s margin: "Married [ ] Single [ ] Spouse\'s name: ____"', row('Married', 10, '[]', 14, { text: 'Single', dx: 0, symbols: letters('Single', []) }, 6 * CHAR - 3, '[]', 14, "Spouse's", 10, 'name:', 12, '___'), ['Married', 'Single', "Spouse's name"]],
  // When the words that belong to a box cannot be told, the box is not named: it is marked unclear, with the words it
  // might be. Never a pick.
  ['one word exactly between two boxes', row('[]', 20, 'Maybe', 20, '[]'), [{ unsure: ['Maybe'] }, { unsure: ['Maybe'] }]],
  ['one word exactly between two boxes, far apart, after a question', row('Unclear', 10, 'spacing:', 60, '[]', 60, 'Maybe', 60, '[]'), [{ unsure: ['Maybe'] }, { unsure: ['Maybe'] }]],
  ['a lone box with words as near on both sides', row('Escort', 10, 'needed', 18, '[]', 18, '(see', 10, 'page', 10, '2)'), [{ unsure: ['Escort needed', '(see page 2)'] }]],
  ['a word, then a pair, all evenly spaced: is "Yes" the first box\'s or the second\'s?', row('Smoker', 20, '[]', 20, 'Yes', 20, '[]', 20, 'No'), [{ unsure: ['Smoker', 'Yes'] }, { unsure: ['Yes', 'No'] }]],
];
for (const [name, input, want] of ROWS) test('checkbox caption: ' + name, () => assert.deepEqual(labelsOf(input), want));

// Known limits, with what they should give. They fail today; node:test reports them as "todo", so they stay in sight
// without failing the run. Each fails safe: the box is left unclear, never given another box's words.
const LIMITS = [
  ['two questions on one line one space apart, with "?": the first No box is unclear', row('Smoker?', 40, '[]', 14, 'Yes', 40, '[]', 14, 'No', 10, 'Pets?', 40, '[]', 14, 'Yes', 40, '[]', 14, 'No'), ['Yes', 'No', 'Yes', 'No']],
  ['two questions on one line one space apart, no "?": the first No box is unclear', row('Smoker', 40, '[]', 14, 'Yes', 40, '[]', 14, 'No', 10, 'Pets', 40, '[]', 14, 'Yes', 40, '[]', 14, 'No'), ['Yes', 'No', 'Yes', 'No']],
  ['a question, a box, then its answer of several words', row('Newsletter?', 14, '[]', 14, 'Yes,', 10, 'send', 10, 'it'), ['Yes, send it']],
  ['a group whose captions are beside the boxes, one caption lost: "Night" is the second box\'s', row('Shift:', 60, '[]', 60, '[]', 14, 'Night'), ['', 'Night']],
];
for (const [name, input, want] of LIMITS) test('known limit: ' + name, { todo: 'a known limit of the caption rule' }, () => assert.deepEqual(labelsOf(input), want));

// More layouts, curated in caption-rows.js: notes, codes, prices, headings, wrapped captions, scales, turned photos.
for (const [name, input, want] of CURATED) test('checkbox caption: ' + name, () => assert.deepEqual(labelsOf(input), want));
for (const [name, input, want] of CURATED_LIMITS) test('known limit: ' + name, { todo: 'a known limit of the caption rule' }, () => assert.deepEqual(labelsOf(input), want));

test('the words a label may use: the reader\'s words for a square go, a caption run into a square keeps its letters, unsure words elsewhere go', () => {
  const box = { kind: 'check', x0: 105, y0: 102, x1: 123, y1: 126 }, at = (text, x0, extra = {}) => ({ text, confidence: 90, bbox: { x0, y0: 100, x1: x0 + text.length * CHAR, y1: 126 }, ...extra });
  const clean = words => lib.cleanWords([box], words).map(word => word.text);
  assert.deepEqual(clean([at('[]', 100), at('[J', 101), at('O', 106)]), [], 'the square read as "[]", "[J" or "O"');
  assert.deepEqual(clean([at('[JMon', 100)]), ['Mon'], 'stored words, no letters: the square\'s marks cut off by shape');
  assert.deepEqual(clean([at('Yes[]', 72)]), ['Yes']);
  assert.deepEqual(clean([at('Mail', 135, { confidence: 40 })]), [], 'an unsure word by itself is no caption');
  assert.deepEqual(clean([at('......', 300), at('-', 400), at('Name', 500)]), ['Name'], 'leaders and dashes alone go');
  const run = at('[_]Mail', 100, { confidence: 28, symbols: letters('[_]Mail', [97, 60, 96, 95, 96, 95, 96])(100, 100) });
  const [mail] = lib.cleanWords([box], [run]);
  assert.equal(mail.text, 'Mail'); assert.ok(mail.bbox.x0 >= 123, 'its box starts after the square: ' + JSON.stringify(mail.bbox));
  // A stored word whose first letter could be a mark: "[" goes, the caption's own I, l or 1 stays.
  assert.deepEqual(clean([at('[Initials', 100)]), ['Initials']); assert.deepEqual(clean([at('[lunch', 100)]), ['lunch']); assert.deepEqual(clean([at('[1st', 100)]), ['1st']);
});

test('a caption letter the reader stretched over the square stays the caption\'s (WebKit read "Yes [ ]" as one word whose "s" reaches the box\'s far side)', () => {
  // WebKit's reading of the checkbox sheet's parking line ("Do you need parking? Yes [ ] No [ ]"), as the page saw it.
  const at = (x0, x1) => ({ x0, y0: 596, x1, y1: 624 }), yes = { kind: 'check', x0: 760, y0: 600, x1: 780, y1: 620 }, no = { kind: 'check', x0: 945, y0: 600, x1: 965, y1: 620 };
  const words = [{ text: 'parking?', confidence: 95, bbox: at(560, 688) },
    { text: 'Yes', confidence: 23, bbox: at(695, 786), symbols: [{ text: 'Y', confidence: 99, bbox: at(695, 714) }, { text: 'e', confidence: 99, bbox: at(715, 730) }, { text: 's', confidence: 89, bbox: at(732, 786) }] },
    { text: 'No', confidence: 96, bbox: at(891, 926) }, { text: '[J', confidence: 46, bbox: at(947, 967) }];
  assert.deepEqual(lib.cleanWords([yes, no], words).map(word => word.text), ['parking?', 'Yes', 'No']);
  assert.ok(lib.cleanWords([yes, no], words)[1].bbox.x1 <= 754, 'the caption ends where the square begins');
  assert.deepEqual(lib.labelBlanks([yes, no], words, 28).map(blank => blank.label), ['Yes', 'No']);
});

test('blanks that are not checkboxes keep the labels 2.2.0 gave them, dashes and dot leaders included', () => {
  for (const [input, want] of [[row('Phone', 10, '-', 10, 'Home', 10, '___'), 'Phone - Home'], [row('Amount', 10, 'due', 10, '.....', 10, '$', 10, '___'), 'Amount due ..... $']]) {
    assert.equal(lib.labelBlanks(input.blanks, input.words, UNIT)[0].label, want);
    assert.equal(lib.labelFor(input.blanks[0], input.words, UNIT), want, 'as labelFor gives it');
  }
});

test('templates keep an unclear checkbox unclear, and refuse nothing else for it', () => {
  const { labelled } = page('checkboxes');
  const template = lib.makeTemplate({ form: { sha256: 'c'.repeat(64), name: 'checkboxes.png', type: 'image' }, pages: [{ width: 1700, height: 2200, pdfPage: null }], blanks: labelled.map(blank => ({ ...blank, page: 0 })) });
  const back = lib.readTemplate(JSON.stringify(template));
  assert.deepEqual(back.blanks.map(blank => blank.unsure ?? null), labelled.map(blank => blank.unsure ?? null));
  assert.deepEqual(back.blanks.map(blank => blank.label), labelled.map(blank => blank.label));
  // A hand-edited `unsure` that is not a list of words is dropped, not trusted.
  const odd = structuredClone(template); odd.blanks[9].unsure = 'Maybe'; odd.blanks[10].unsure = [7, '', ' '];
  const read = lib.readTemplate(odd);
  assert.equal(read.blanks[9].unsure, undefined); assert.equal(read.blanks[10].unsure, undefined);
  // It belongs to a checkbox with no label only; elsewhere it goes. Its words are trimmed.
  const misplaced = structuredClone(template); misplaced.blanks[0].unsure = ['Name?']; misplaced.blanks[1].unsure = ['Maybe']; misplaced.blanks[9].unsure = [' Maybe '];
  const kept = lib.readTemplate(misplaced);
  assert.equal(kept.blanks[0].unsure, undefined, 'not on a line'); assert.equal(kept.blanks[1].unsure, undefined, 'not beside a label'); assert.deepEqual(kept.blanks[9].unsure, ['Maybe']);
});

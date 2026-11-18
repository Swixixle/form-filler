import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { findBlanks, findOptions, nameOptions, labelFor, skewOf, rotate } from '../src/lib/blanks.js';
import { splitAnswers, placeAnswers } from '../src/lib/answers.js';

// Invented forms drawn by scripts/make-fixtures.py. Synthetic test material.
const grayOf = name => { const png = PNG.sync.read(readFileSync(new URL('./fixtures/' + name, import.meta.url))), gray = new Uint8Array(png.width * png.height);
  for (let at = 0; at < gray.length; at++) gray[at] = Math.round(0.299 * png.data[at * 4] + 0.587 * png.data[at * 4 + 1] + 0.114 * png.data[at * 4 + 2]); return { gray, width: png.width, height: png.height }; };
// What the invented form has, in reading order: Name, Date, Department, two empty table rows of three cells, Day,
// Night, the comments box under its caption, Signature.
const EXPECTED = ['line', 'line', 'line', 'box', 'box', 'box', 'box', 'box', 'box', 'check', 'check', 'box', 'line'];
const near = (blank, x0, y0, slack = 40) => Math.abs(blank.x0 - x0) <= slack && Math.abs(blank.y1 - y0) <= slack;

test('a clean form: every blank found, in reading order, and the table header is not a blank', () => {
  const { gray, width, height } = grayOf('form.png');
  const blanks = findBlanks(gray, width, height);
  assert.deepEqual(blanks.map(blank => blank.kind), EXPECTED, JSON.stringify(blanks));
  assert.ok(near(blanks[0], 225, 318), 'Name sits after its label: ' + JSON.stringify(blanks[0]));
  assert.ok(blanks[3].y0 > 520 + 70, 'the first table blanks are in the second row, under the header');
  assert.ok(blanks[11].y0 > 950 + 20, 'the comments blank starts under its caption');
});

test('the same form as a crooked, shaded phone photo: straightened, then the same blanks', () => {
  const { gray, width, height } = grayOf('form-photo.png');
  const angle = skewOf(gray, width, height);
  assert.ok(Math.abs(angle - 1.2) <= 0.3 || Math.abs(angle + 1.2) <= 0.3, 'skew found: ' + angle);
  const straight = rotate(gray, width, height, angle);
  assert.deepEqual(findBlanks(straight, width, height).map(blank => blank.kind), EXPECTED);
});

test('the same forms as WebKit draws them (Safari, an iPhone, the Mac app): no blank where there is none', () => {
  // form-webkit.png and fillable-webkit.png are the two invented PDFs exactly as WebKit 26.6 drew them for the page
  // (the gray pixels the blank finder was given). WebKit draws small print a little differently from Chromium, and
  // two things that are not blanks used to pass for them there.
  const form = grayOf('form-webkit.png'), fillable = grayOf('fillable-webkit.png');
  const onForm = findBlanks(form.gray, form.width, form.height);
  assert.deepEqual(onForm.map(blank => blank.kind), EXPECTED, 'the ring of the Q in "Qty" is not a checkbox: ' + JSON.stringify(onForm.filter(blank => blank.kind === 'check')));
  const onFillable = findBlanks(fillable.gray, fillable.width, fillable.height);
  assert.ok(onFillable.every(blank => blank.y0 > 200), 'the tops of the bold title\'s letters are not a line to write on: ' + JSON.stringify(onFillable[0]));
  // What is left: the four text fields' boxes, the checkbox, the big box, and the signature line (a radio button is round, not a box).
  assert.deepEqual(onFillable.map(blank => blank.kind), ['box', 'box', 'box', 'box', 'check', 'box', 'line']);
});

test('round option buttons on a flat page: every set found, one blank a set; letters, zeros and bullets are not buttons', () => {
  // options.png is the invented round-button form drawn by scripts/make-option-fixture.mjs (poppler's picture of it);
  // options-webkit.png is the same page as WebKit 26.6 drew it. 14 buttons in 6 sets, and beside them capital O's,
  // zeros, a Q, "o" bullets and a bold heading, none of which is a button.
  for (const name of ['options.png', 'options-webkit.png']) {
    const { gray, width, height } = grayOf(name), sets = findOptions(gray, width, height);
    assert.deepEqual(sets.map(set => set.spots.length), [2, 2, 3, 2, 2, 3], name + ': ' + JSON.stringify(sets));
    assert.ok(sets.every(set => set.kind === 'choice' && set.choice === 'radio'), 'each set is one choice');
    assert.ok(Math.abs(sets[3].y0 - sets[4].y0) < 4 && sets[3].x1 < sets[4].x0, name + ': two questions on one line are two sets, not one of four');
    const under = sets[5].spots;
    assert.ok(under.every(spot => Math.abs(spot.x0 - under[0].x0) <= 2) && under[0].y1 < under[1].y0 && under[1].y1 < under[2].y0, name + ': the last set runs down the page');
    for (const spot of sets.flatMap(set => set.spots)) { const wide = spot.x1 - spot.x0, tall = spot.y1 - spot.y0; assert.ok(wide >= 22 && wide <= 34 && Math.abs(wide - tall) <= 2, name + ': a button is round: ' + JSON.stringify(spot)); }
    // What the blank finder finds on the same page is what it found before: the two lines and the one square checkbox.
    assert.deepEqual(findBlanks(gray, width, height).map(blank => blank.kind), ['line', 'check', 'line'], name);
  }
  // The forms that once grew phantom blanks have no option buttons at all.
  for (const name of ['form.png', 'form-photo.png', 'form-webkit.png']) { const { gray, width, height } = grayOf(name); assert.deepEqual(findOptions(gray, width, height), [], name); }
  // A fillable PDF's own two radio buttons, as drawn on the page, are one set of two.
  const fillable = grayOf('fillable-webkit.png');
  assert.deepEqual(findOptions(fillable.gray, fillable.width, fillable.height).map(set => set.spots.length), [2]);
});

test('an option button is called by the words after it, and its set by the question before it', () => {
  const { gray, width, height } = grayOf('options.png'), sets = findOptions(gray, width, height);
  // Words as the text reader gives them. Each button's word starts 14 pixels after it; "Wheelchair access?" sits
  // between the two sets that share a line.
  const word = (text, x0, y0) => ({ text, bbox: { x0, y0, x1: x0 + text.length * 14, y1: y0 + 26 } }), after = (spot, text) => word(text, spot.x1 + 14, spot.y0 + 2), line = sets[3].y0 + 2;
  const words = [...sets[2].spots.map((spot, index) => after(spot, ['Phone', 'E-mail', 'Post'][index])), word('Parking', 200, line), word('needed?', 320, line),
    after(sets[3].spots[0], 'Yes'), after(sets[3].spots[1], 'No'), word('Wheelchair', 834, line), word('access?', 990, line), after(sets[4].spots[0], 'Yes'), after(sets[4].spots[1], 'No')];
  assert.deepEqual(nameOptions(sets[2], words, 49).options, ['Phone', 'E-mail', 'Post']);
  assert.deepEqual(nameOptions(sets[3], words, 49).options, ['Yes', 'No'], 'the next question is not part of "No"');
  assert.deepEqual(nameOptions(sets[4], words, 49).options, ['Yes', 'No']);
  assert.deepEqual(nameOptions(sets[4], words, 49).spots.map(spot => spot.option), ['Yes', 'No'], 'each button knows its own word');
  assert.deepEqual(nameOptions(sets[0], [], 49).options, ['1', '2'], 'with nothing read, a button is called by its number');
  assert.equal(labelFor(sets[3], words, 49), 'Parking needed?'); assert.equal(labelFor(sets[4], words, 49), 'Wheelchair access?');
});

// KNOWN DEFECT 11 (docs/INVENTORY.md): in a table whose rows are about 61 px high at the page's working width (22 pt
// on a Letter page), the upright strokes of the header's letters pass for cell walls, so the header cell is split and
// parts of it are offered as blanks. A blank that is not there shifts every answer typed after it by one. This test
// says what should happen; it fails today, and node:test reports it as "todo" until the finder is fixed.
test('a table with tight rows (61 px): its six empty cells are the blanks, and nothing in its header row', { todo: 'known defect 11: letters in a tight header row are taken for cell walls' }, () => {
  // tests/fixtures/tight-table.png (scripts/make-tight-table-fixture.mjs): Visitor | Room | Badge over two empty rows.
  const { gray, width, height } = grayOf('tight-table.png');
  const blanks = findBlanks(gray, width, height), headerBottom = 370;
  assert.deepEqual(blanks.filter(blank => blank.y0 < headerBottom).map(blank => [blank.kind, blank.x0, blank.y0, blank.x1, blank.y1]), [], 'no blank in the header row');
  assert.deepEqual(blanks.map(blank => blank.kind), ['box', 'box', 'box', 'box', 'box', 'box']);
});

test('answers: periods and new lines move on, a dash or extra period leaves a blank empty, a number jumps', () => {
  assert.deepEqual(splitAnswers('Jane Roe. 11/13/2026. Respiratory\n\nPEEP 7.5 cm. Dr. Patel. J. R. Smith').map(answer => answer.text),
    ['Jane Roe', '11/13/2026', 'Respiratory', 'PEEP 7.5 cm', 'Dr. Patel', 'J. R. Smith']);
  assert.deepEqual(splitAnswers('jane@example.org. www.example.org/a.b. Seen at 4 p.m. Friday. v1.2').map(answer => answer.text),
    ['jane@example.org', 'www.example.org/a.b', 'Seen at 4 p.m. Friday', 'v1.2']);
  assert.deepEqual(splitAnswers('Jane. -. Night').map(answer => answer.text), ['Jane', '', 'Night']);
  assert.deepEqual(splitAnswers('Jane.. Night').map(answer => answer.text), ['Jane', '', 'Night']);
  assert.deepEqual(splitAnswers('. Night').map(answer => answer.text), ['', 'Night']);
  assert.deepEqual(splitAnswers('Jane. 4) yes. Done at 4:30 pm'), [{ text: 'Jane', at: null }, { text: 'yes', at: 4 }, { text: 'Done at 4:30 pm', at: null }]);
  const blanks = [{ kind: 'line' }, { kind: 'line' }, { kind: 'check' }, { kind: 'check' }, { kind: 'line' }];
  assert.deepEqual(placeAnswers(blanks, 'Jane Roe. 11/13/2026. no. x. Signed. extra one'), { values: ['Jane Roe', '11/13/2026', false, true, 'Signed'], extra: ['extra one'] });
  assert.deepEqual(placeAnswers(blanks, 'Jane. 4: yes. Signed').values, ['Jane', '', false, true, 'Signed']);
});

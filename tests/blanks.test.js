import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { findBlanks, skewOf, rotate } from '../src/blanks.js';
import { splitAnswers, placeAnswers } from '../src/answers.js';

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

test('answers: periods and new lines move on, a dash or extra period leaves a blank empty, a number jumps', () => {
  assert.deepEqual(splitAnswers('Jane Roe. 11/13/2026. Respiratory\n\nPEEP 7.5 cm. Dr. Patel. J. R. Smith').map(answer => answer.text),
    ['Jane Roe', '11/13/2026', 'Respiratory', 'PEEP 7.5 cm', 'Dr. Patel', 'J. R. Smith']);
  assert.deepEqual(splitAnswers('Jane. -. Night').map(answer => answer.text), ['Jane', '', 'Night']);
  assert.deepEqual(splitAnswers('Jane.. Night').map(answer => answer.text), ['Jane', '', 'Night']);
  assert.deepEqual(splitAnswers('. Night').map(answer => answer.text), ['', 'Night']);
  assert.deepEqual(splitAnswers('Jane. 4) yes. Done at 4:30 pm'), [{ text: 'Jane', at: null }, { text: 'yes', at: 4 }, { text: 'Done at 4:30 pm', at: null }]);
  const blanks = [{ kind: 'line' }, { kind: 'line' }, { kind: 'check' }, { kind: 'check' }, { kind: 'line' }];
  assert.deepEqual(placeAnswers(blanks, 'Jane Roe. 11/13/2026. no. x. Signed. extra one'), { values: ['Jane Roe', '11/13/2026', false, true, 'Signed'], extra: ['extra one'] });
  assert.deepEqual(placeAnswers(blanks, 'Jane. 4: yes. Signed').values, ['Jane', '', false, true, 'Signed']);
});

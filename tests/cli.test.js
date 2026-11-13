import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { PDFDocument } from 'pdf-lib';
import { findBlanks, makeTemplate } from '../src/lib/index.js';

// The command line, run as another program would run it, on the invented fixtures.
const bin = fileURLToPath(new URL('../bin/form-filler.mjs', import.meta.url)), fixture = name => fileURLToPath(new URL('./fixtures/' + name, import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'ff-cli-')), at = name => join(dir, name);
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
const fieldsOf = async file => Object.fromEntries((await PDFDocument.load(readFileSync(file))).getForm().getFields().map(field => [field.getName(), field.constructor.name === 'PDFCheckBox' ? field.isChecked() : field.constructor.name === 'PDFDropdown' ? field.getSelected()[0] : field.constructor.name === 'PDFRadioGroup' ? field.getSelected() : field.getText() ?? '']));
const pdfText = file => { const out = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }); assert.equal(out.stderr, ''); return out.stdout; };

test('fields: a template straight from a PDF\'s own fields, with no page and no browser', () => {
  const made = run('fields', fixture('fillable.pdf'), '--out', at('fillable.json'));
  assert.equal(made.status, 0, made.stderr);
  const checked = run('check', at('fillable.json'));
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /fillable\.pdf \(pdf, SHA-256 [0-9a-f]{64}\): 1 page\(s\), 8 blanks/);
  assert.match(checked.stdout, /5 {2}choice Unit {2}\[unit\] {2}\{ICU \| Emergency \| Floor\}/);
});

test('fill: answers by the page\'s rules, details and a fixed date, into the PDF\'s own fields', async () => {
  writeFileSync(at('me.json'), JSON.stringify({ fullName: 'Jane Roe', email: 'jane@example.org' }));
  const out = run('fill', '--template', at('fillable.json'), '--form', fixture('fillable.pdf'), '--details', at('me.json'), '--today', '2026-11-13',
    '--answers', '555-0100. icu. day. x. Training visit', '--out', at('filled.pdf'));
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(await fieldsOf(at('filled.pdf')), { full_name: 'Jane Roe', email: 'jane@example.org', phone: '555-0100', visit_date: '11/13/2026', unit: 'ICU', shift: 'Day', escort: true, reason: 'Training visit' });
});

test('fill --strict: anything that could not go in fails the run, and says what', () => {
  const out = run('fill', '--template', at('fillable.json'), '--form', fixture('fillable.pdf'), '--answers', '-. -. -. -. Pharmacy', '--strict', '--out', at('strict.pdf'));
  assert.equal(out.status, 2);
  assert.match(out.stderr, /"Pharmacy" is not one of its choices/);
});

test('fill refuses a form that is not the one the template was made for, unless told', () => {
  const out = run('fill', '--template', at('fillable.json'), '--form', fixture('form.pdf'), '--answers', 'x', '--out', at('wrong.pdf'));
  assert.equal(out.status, 1); assert.match(out.stderr, /is not the file this template was made from/);
});

test('fill --csv on a photographed form\'s template (which carries its own page picture): one PDF, a copy per row', async () => {
  const png = PNG.sync.read(readFileSync(fixture('form.png'))), gray = new Uint8Array(png.width * png.height);
  for (let index = 0; index < gray.length; index++) gray[index] = png.data[index * 4];
  const blanks = findBlanks(gray, png.width, png.height).map(blank => ({ ...blank, page: 0 }));
  const template = makeTemplate({ form: { sha256: 'b'.repeat(64), name: 'form.png', type: 'image' }, pages: [{ width: png.width, height: png.height, pdfPage: null, image: 'data:image/png;base64,' + readFileSync(fixture('form.png')).toString('base64') }], blanks });
  writeFileSync(at('photo.json'), JSON.stringify(template));
  writeFileSync(at('rows.csv'), '1,3,Shade\nAlex Doe,Pharmacy,blue\nSam Poe,Respiratory,\n');
  const out = run('fill', '--template', at('photo.json'), '--csv', at('rows.csv'), '--out', at('merged.pdf'));
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stderr, /Columns that name no blank \(left out\): Shade/);
  assert.equal((await PDFDocument.load(readFileSync(at('merged.pdf')))).getPageCount(), 2);
  const text = pdfText(at('merged.pdf'));
  for (const word of ['Alex Doe', 'Pharmacy', 'Sam Poe', 'Respiratory']) assert.ok(text.includes(word), word);
});

test('check: a damaged template is refused with exactly what is wrong', () => {
  const template = JSON.parse(readFileSync(at('fillable.json'), 'utf8')); template.blanks[3].page = 7;
  writeFileSync(at('bad.json'), JSON.stringify(template));
  const out = run('check', at('bad.json'));
  assert.equal(out.status, 1); assert.match(out.stderr, /blank 4 is on a page the template does not have/);
});

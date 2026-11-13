#!/usr/bin/env node
// Form Filler from the command line, for other programs (and for filling the same form many times). No browser, no
// network. It works from a template (the form's blanks, saved from the page, or made here from a PDF's own fields).
//
//   form-filler fields FORM.pdf [--out TEMPLATE.json]
//       A template from a PDF's own fill-in fields.
//   form-filler fill --template TEMPLATE.json [--form FORM.pdf] (--answers TEXT | --answers-file FILE | --csv ROWS.csv)
//                    [--details DETAILS.json] [--today YYYY-MM-DD | --no-date] [--print] [--strict] [--any-form] --out OUT.pdf
//       The filled form. Answers follow the same rules as the page (a period or a new line moves on, "-" skips,
//       "4)" jumps). With --csv, one print-ready copy per row, all in one PDF. --details fills your saved details
//       (and today's date, unless --no-date) the way the page does. --print makes it print-ready instead of editable.
//       --strict fails (exit 2) when anything could not go in as written. The form must be the one the template was
//       made from (same SHA-256) unless --any-form is given.
//   form-filler check TEMPLATE.json
//       Reads a template and says what is in it, or exactly what is wrong with it.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFields, readTemplate, makeTemplate, placeAnswers, buildPdf, joinPdfs, autofill, parseCsv, matchColumns, rowValues } from '../src/lib/index.js';
import { PDFDocument } from 'pdf-lib';

const [command, ...rest] = process.argv.slice(2);
const flags = {}, loose = [];
for (let index = 0; index < rest.length; index++) {
  const arg = rest[index];
  if (!arg.startsWith('--')) { loose.push(arg); continue; }
  const name = arg.slice(2);
  if (['print', 'strict', 'any-form', 'no-date'].includes(name)) flags[name] = true; else flags[name] = rest[++index];
}
const fail = (message, code = 1) => { process.stderr.write('form-filler: ' + message + '\n'); process.exit(code); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => { try { return readFileSync(file); } catch (error) { return fail('cannot read ' + file + ': ' + error.message); } };
const dataBytes = url => Buffer.from(url.replace(/^data:[^,]*,/, ''), 'base64');

async function fields() {
  const file = loose[0] || fail('which PDF? form-filler fields FORM.pdf');
  const bytes = read(file), own = await readFields(bytes);
  if (own.encrypted) fail('this PDF is locked against changes; its fields cannot be filled here.');
  if (own.rotated) fail('this PDF has turned pages; use the page to place its blanks instead.');
  if (!own.blanks.length) fail('this PDF has no fill-in fields of its own' + (own.xfa ? ' (it is an XFA form)' : '') + '. Make a template on the page instead.');
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true }), used = [...new Set(own.blanks.map(blank => blank.page))].sort((a, b) => a - b);
  const pages = doc.getPages().map((page, index) => { const box = page.getCropBox(); return { width: box.width, height: box.height, pdfPage: index }; });
  const name = file.split(/[\\/]/).pop(), template = makeTemplate({ form: { sha256: sha256(bytes), name, type: 'pdf' }, pages, blanks: own.blanks });
  const text = JSON.stringify(template, null, 1) + '\n';
  if (flags.out) { writeFileSync(flags.out, text); process.stderr.write(own.blanks.length + ' fields on ' + used.length + ' page(s) → ' + flags.out + '\n'); } else process.stdout.write(text);
}

async function fill() {
  if (!flags.template) fail('--template is needed (save one from the page, or make one with "form-filler fields").');
  if (!flags.out) fail('--out is needed: where to write the PDF.');
  let template;
  try { template = readTemplate(read(flags.template).toString('utf8')); } catch (error) { fail(error.message); }
  let sourcePdf = null;
  if (template.form.type === 'pdf') {
    if (!flags.form) fail('this template is for a PDF form: give the form with --form.');
    sourcePdf = read(flags.form);
    if (sha256(sourcePdf) !== template.form.sha256 && !flags['any-form']) fail('--form is not the file this template was made from (SHA-256 ' + sha256(sourcePdf).slice(0, 12) + '…, template expects ' + template.form.sha256.slice(0, 12) + '…). Add --any-form to use it anyway.');
  } else if (!template.pages.every(page => page.image)) fail('this template is for a photographed form but carries no picture of it. Save the template again from the page.');
  const pages = template.pages.map(page => ({ ...page, image: page.image ? { type: /^data:image\/png/.test(page.image) ? 'png' : 'jpg', bytes: dataBytes(page.image) } : null }));
  const { blanks } = template;
  let profile = null;
  if (flags.details) { try { profile = JSON.parse(read(flags.details).toString('utf8')); } catch (error) { fail('--details is not JSON: ' + error.message); } }
  const today = flags['no-date'] ? null : flags.today ? new Date(flags.today + 'T12:00:00') : new Date();
  if (today && Number.isNaN(today.getTime())) fail('--today must be a date like 2026-11-13.');
  const fixed = profile ? autofill(blanks, profile, { today }) : new Map();
  const problems = [];
  const text = flags['answers-file'] ? read(flags['answers-file']).toString('utf8') : flags.answers ?? '';
  const { values, extra } = placeAnswers(blanks, text, { skip: new Set(fixed.keys()) });
  const base = values.map((value, index) => value !== '' && value !== false ? value : fixed.get(index) ?? value);
  if (extra.length) problems.push('More answers than blanks; not placed: ' + extra.join(' / '));
  let bytes, made;
  if (flags.csv) {
    const rows = parseCsv(read(flags.csv).toString('utf8'));
    if (rows.length < 2) fail('the CSV needs a heading row and at least one row of answers.');
    const { columns, unmatched } = matchColumns(blanks, rows[0]);
    if (!columns.some(column => column !== null)) fail('no column of the CSV names a blank (by number, field name or label).');
    if (unmatched.length) problems.push('Columns that name no blank (left out): ' + unmatched.join(', '));
    const copies = [];
    for (const [index, row] of rows.slice(1).entries()) {
      const found = [];
      copies.push(await buildPdf({ pages, blanks, values: rowValues(blanks, columns, row, base), sourcePdf, editable: false, problems: found }));
      problems.push(...found.map(problem => 'Row ' + (index + 1) + ': ' + problem));
    }
    bytes = await joinPdfs(copies); made = copies.length + ' filled copies';
  } else {
    bytes = await buildPdf({ pages, blanks, values: base, sourcePdf, editable: !flags.print, problems, note: 'Filled with Form Filler. Form SHA-256 ' + template.form.sha256 + '. Answers SHA-256 ' + sha256(text) + '.' });
    made = flags.print ? 'print-ready' : 'editable';
  }
  writeFileSync(flags.out, bytes);
  for (const problem of problems) process.stderr.write('note: ' + problem + '\n');
  process.stderr.write(flags.out + ' (' + made + ', SHA-256 ' + sha256(bytes) + ')\n');
  if (flags.strict && problems.length) process.exit(2);
}

function check() {
  const file = loose[0] || fail('which template? form-filler check TEMPLATE.json');
  let template;
  try { template = readTemplate(read(file).toString('utf8')); } catch (error) { fail(error.message); }
  const kinds = {}; for (const blank of template.blanks) kinds[blank.kind] = (kinds[blank.kind] || 0) + 1;
  process.stdout.write((template.form.name || 'form') + ' (' + template.form.type + ', SHA-256 ' + template.form.sha256 + '): ' + template.pages.length + ' page(s), ' + template.blanks.length + ' blanks (' + Object.entries(kinds).map(([kind, count]) => count + ' ' + kind).join(', ') + ')\n');
  template.blanks.forEach((blank, index) => process.stdout.write(String(index + 1).padStart(3) + '  ' + blank.kind.padEnd(6) + ' ' + (blank.label || '') + (blank.field ? '  [' + blank.field + ']' : '') + (blank.options ? '  {' + blank.options.join(' | ') + '}' : '') + '\n'));
}

if (command === 'fields') await fields();
else if (command === 'fill') await fill();
else if (command === 'check') check();
else { process.stdout.write(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1).filter(line => line.startsWith('//')).map(line => line.slice(3)).join('\n') + '\n'); if (command && command !== 'help' && command !== '--help') process.exit(1); }

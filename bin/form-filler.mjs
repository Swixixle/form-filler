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
//
// The archive (a plain folder of everything that came in or went out; nothing in it is ever deleted or overwritten).
// ITEM is an item's folder, as `add` prints it: a path inside the archive, or a full path to it; MATTER the same, or a
// path like Taxes/2026. Its flags are read strictly: one it does not know, one given twice or one with no value is
// refused, so a file is never taken for a flag's value. "--matter Taxes/2026" and "--matter=Taxes/2026" are the same.
//   form-filler archive add ARCHIVE --direction in|out --counterparty WHO --title WHAT [--matter MATTER]
//                       [--channel HOW] [--sent DATE | --received DATE] [--role ROLE] FILE...
//       Files a new item: its folder in MATTER (with none, _Unsorted), each FILE behind the one role word (default
//       "document"). The archive's folder is made if it does not exist. Prints the item's folder.
//   form-filler archive file ARCHIVE ITEM [--role ROLE] FILE...
//       Adds files to an item, beside what is there.
//   form-filler archive move ARCHIVE ITEM --matter MATTER
//       Moves an item to another matter, and writes the move in its record.
//   form-filler archive index ARCHIVE
//       Makes the index (.formfiller/index.json) again from every record. It keeps a list of the items that have
//       left the archive; to accept that one has, delete the index and make it again.
//   form-filler archive verify ARCHIVE [--strict]
//       Reads every file again and says what is missing, changed or not recorded, and which items the index knew
//       that have left the archive. Changes nothing. Exits 1 if anything is missing, changed, gone, unfinished or
//       unreadable; with --strict, also if anything is not recorded.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { readFields, readTemplate, makeTemplate, placeAnswers, buildPdf, joinPdfs, autofill, parseCsv, matchColumns, rowValues, openArchive, checkItem, sha256 } from '../src/lib/index.js';
import { nodeFiles } from '../src/lib/files/node.js';
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
  const name = file.split(/[\\/]/).pop(), template = makeTemplate({ form: { sha256: await sha256(bytes), name, type: 'pdf' }, pages, blanks: own.blanks });
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
    const print = await sha256(sourcePdf);
    if (print !== template.form.sha256 && !flags['any-form']) fail('--form is not the file this template was made from (SHA-256 ' + print.slice(0, 12) + '…, template expects ' + template.form.sha256.slice(0, 12) + '…). Add --any-form to use it anyway.');
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
    bytes = await buildPdf({ pages, blanks, values: base, sourcePdf, editable: !flags.print, problems, note: 'Filled with Form Filler. Form SHA-256 ' + template.form.sha256 + '. Answers SHA-256 ' + await sha256(text) + '.' });
    made = flags.print ? 'print-ready' : 'editable';
  }
  writeFileSync(flags.out, bytes);
  for (const problem of problems) process.stderr.write('note: ' + problem + '\n');
  process.stderr.write(flags.out + ' (' + made + ', SHA-256 ' + await sha256(bytes) + ')\n');
  if (flags.strict && problems.length) process.exit(2);
}

function check() {
  const file = loose[0] || fail('which template? form-filler check TEMPLATE.json');
  let template;
  try { template = readTemplate(read(file).toString('utf8')); } catch (error) { fail(error.message); }
  const kinds = {}; for (const blank of template.blanks) kinds[blank.kind] = (kinds[blank.kind] || 0) + 1;
  process.stdout.write((template.form.name || 'form') + ' (' + template.form.type + ', SHA-256 ' + template.form.sha256 + '): ' + template.pages.length + ' page(s), ' + template.blanks.length + ' blanks (' + Object.entries(kinds).map(([kind, count]) => count + ' ' + kind).join(', ') + ')\n');
  template.blanks.forEach((blank, index) => process.stdout.write(String(index + 1).padStart(3) + '  ' + blank.kind.padEnd(6) + ' ' + (blank.label || (blank.unsure ? '(unclear: ' + blank.unsure.join(' or ') + ')' : '')) + (blank.field ? '  [' + blank.field + ']' : '') + (blank.options ? '  {' + blank.options.join(' | ') + '}' : '') + '\n'));
}

async function archive() {
  // The archive's own flags, read strictly, so a file is never quietly taken for a flag's value and left out.
  const OPTIONS = { add: ['direction', 'counterparty', 'title', 'matter', 'channel', 'sent', 'received', 'role'], file: ['role'], move: ['matter'], index: [], verify: ['strict'] };
  const given = {}, plain = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === '--') { plain.push(...rest.slice(index + 1)); break; }
    if (!arg.startsWith('--')) { plain.push(arg); continue; }
    const equals = arg.indexOf('='), name = equals < 0 ? arg.slice(2) : arg.slice(2, equals);
    if (name in given) fail('--' + name + ' is given twice.' + (name === 'role' ? ' One role per run: to give files different roles, run "archive file" once for each.' : ''));
    if (name === 'strict') { if (equals >= 0) fail('--strict takes no value.'); given.strict = true; continue; }
    const value = equals >= 0 ? arg.slice(equals + 1) : rest[++index];
    if (value === undefined || value === '' || (equals < 0 && value.startsWith('--'))) fail('--' + name + ' needs a value.');
    given[name] = value;
  }
  const [action, folder, ...more] = plain;
  if (!OPTIONS[action] || !folder) fail('form-filler archive add|file|move|index|verify ARCHIVE ... ("form-filler help" says more)');
  for (const name of Object.keys(given)) if (!OPTIONS[action].includes(name))
    fail('--' + name + ' is not an option of "archive ' + action + '"' + (OPTIONS[action].length ? '; it takes ' + OPTIONS[action].map(option => '--' + option).join(', ') : '') + '.');
  if (existsSync(folder) && !statSync(folder).isDirectory()) fail(folder + ' is not a folder.');
  if (action !== 'add' && !existsSync(folder)) fail(folder + ' is not a folder.');
  const root = resolve(folder);
  // A path inside the archive, as `add` prints it, or a full path to something in it (say, dragged in from Finder).
  const inside = path => {
    if (!isAbsolute(path)) return path.split(sep).join('/').replace(/^(\.\/)+/, '');
    const within = relative(root, path);
    if (!within || within.startsWith('..') || isAbsolute(within)) fail(path + ' is not inside ' + folder + '.');
    return within.split(sep).join('/');
  };
  const documents = paths => paths.map(path => ({ role: given.role || 'document', name: basename(path), bytes: read(path) }));
  const line = (word, text) => process.stdout.write(word.padEnd(14) + text + '\n');
  try {
    if (action === 'add') {
      if (!more.length) fail('which files? form-filler archive add ARCHIVE --direction in|out --counterparty WHO --title WHAT FILE...');
      const details = { matter: given.matter === undefined ? null : inside(given.matter), title: given.title, direction: given.direction, counterparty: given.counterparty,
        channel: given.channel || 'hand', dates: { sent: given.sent ?? null, received: given.received ?? null }, files: documents(more) };
      checkItem(details);   // refused here, before the archive's folder is made
      mkdirSync(folder, { recursive: true });
      const book = openArchive(nodeFiles(root)), { path } = await book.createItem(details);
      await book.init();
      process.stdout.write(path + '\n');
      return;
    }
    const book = openArchive(nodeFiles(root));
    if (action === 'file') {
      const [item, ...paths] = more;
      if (!item || !paths.length) fail('which item, and which files? form-filler archive file ARCHIVE ITEM FILE...');
      for (const document of documents(paths)) process.stdout.write((await book.addFile(inside(item), document)).file.name + '\n');
    } else if (action === 'move') {
      if (more.length !== 1 || !given.matter) fail('which item, and to which matter? form-filler archive move ARCHIVE ITEM --matter MATTER');
      process.stdout.write((await book.moveItem(inside(more[0]), inside(given.matter))).path + '\n');
    } else if (action === 'index') {
      const index = await book.rebuildIndex();
      for (const path of index.notRecorded) line('not recorded', path);
      for (const item of index.left) line('left', item.path + ': ' + item.title + ', no longer in the archive (noticed ' + item.noticed + ')');
      for (const { path, what } of index.unfinished) line('unfinished', path + ': ' + what);
      for (const { path, problem } of index.problems) line('problem', path + ': ' + problem);
      process.stdout.write(index.items.length + ' item(s) in the index, .formfiller/index.json.\n');
    } else {
      const report = await book.verify();
      for (const path of report.missing) line('missing', path);
      for (const path of report.changed) line('changed', path);
      for (const item of report.gone) line('gone', item.path + ': ' + item.title + ' (' + item.files + ' file(s)) is no longer in the archive');
      for (const path of report.unrecorded) line('not recorded', path);
      for (const { path, what } of report.unfinished) line('unfinished', path + ': ' + what);
      for (const { path, problem } of report.problems) line('problem', path + ': ' + problem);
      for (const { path, note } of report.notes) line('note', path + ': ' + note);
      process.stdout.write(report.items + ' item(s), ' + report.files + ' recorded file(s): ' + (report.ok ? 'every recorded file is there, byte for byte' : 'not as recorded')
        + (report.unrecorded.length ? '; ' + report.unrecorded.length + ' not recorded' : '') + '.\n');
      // Set, not exit: an exit now would drop the end of a long report still on its way through a pipe.
      if (!report.ok || (given.strict && report.unrecorded.length)) process.exitCode = 1;
    }
  } catch (error) { fail(error.message); }
}

if (command === 'fields') await fields();
else if (command === 'fill') await fill();
else if (command === 'check') check();
else if (command === 'archive') await archive();
else { process.stdout.write(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1).filter(line => line.startsWith('//')).map(line => line.slice(3)).join('\n') + '\n'); if (command && command !== 'help' && command !== '--help') process.exit(1); }

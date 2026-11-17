#!/usr/bin/env node
// The never-list gate. It stops a commit that carries personal information, before the commit exists.
//
// What it looks for:
//   1. Shapes (kept here, in the repository): a Social Security number, a bank routing number, an account, licence
//      or date-of-birth value written after its label, an e-mail address that is not an invented one, a home-folder
//      path with an account name in it. No real value is written in this file.
//   2. Your own values: your name, birthdate, addresses, licence and account numbers, found however they are spaced,
//      cased or punctuated. The values themselves are kept nowhere. never-list/local.txt (which git ignores) holds a
//      keyed fingerprint (HMAC-SHA256) of each, and the key is in the macOS Keychain, so the file alone, read, copied
//      or backed up, says nothing about them.
//   3. Files that are not text (pictures, PDFs, video): each must be listed in never-list/invented-files.txt, which
//      is how someone says "this one is invented". A PDF's text is also read and checked like any other text.
//   4. Paths that belong outside the repository: the local values file itself, encrypted vault files, anything from
//      the archive or backup folders.
//
// What it prints never shows a whole value: only its last four characters.
//
//   node scripts/never-list.mjs --staged            what is about to be committed (the pre-commit hook)
//   node scripts/never-list.mjs --message FILE      a commit message (the commit-msg hook)
//   node scripts/never-list.mjs --all               every tracked file as it is now
//   node scripts/never-list.mjs --history [RANGE]   every line each commit added, and each commit message
//   node scripts/never-list.mjs add                 put one of your own values on the local list (typed, not shown)
//   node scripts/never-list.mjs remove              take one off again (typed, not shown)
//   node scripts/never-list.mjs list                how many values of each kind the local list holds
//   node scripts/never-list.mjs convert             replace a local list written in plain text by fingerprints
//   node scripts/never-list.mjs vouch FILE...       say that a picture, PDF or video is invented
//
// Exit 0: clean. Exit 1: something was found, nothing was committed. Exit 2: the gate could not run (also blocks).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const LOCAL = 'never-list/local.txt', INVENTED = 'never-list/invented.txt', VOUCHED = 'never-list/invented-files.txt';
export const KINDS = ['name', 'birthdate', 'address', 'licence', 'account', 'phone', 'other'];

// Only the last four characters of anything found are ever shown.
export const mask = text => { const value = String(text); return '•'.repeat(Math.max(0, value.length - 4)) + value.slice(-4); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '');

// A Social Security number that could have been issued: the first part is never 000, 666 or 900 to 999, the second
// never 00, the third never 0000. Numbers that fail this (987-65-4321, say) are the ones to use in invented material.
export const plausibleSsn = (area, group, serial) => area !== '000' && area !== '666' && area[0] !== '9' && group !== '00' && serial !== '0000';
// A bank routing number: nine digits, a Federal Reserve prefix, and the checksum 3-7-1.
export function routingNumber(digits) {
  if (!/^\d{9}$/.test(digits)) return false;
  const prefix = Number(digits.slice(0, 2)), d = [...digits].map(Number);
  const known = (prefix >= 1 && prefix <= 12) || (prefix >= 21 && prefix <= 32) || (prefix >= 61 && prefix <= 72) || prefix === 80;
  return known && (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + d[2] + d[5] + d[8]) % 10 === 0;
}
const DATE = '(?:\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.? \\d{1,2},? \\d{4}|\\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.? \\d{4})';
// E-mail addresses that belong to nobody: the domains reserved for examples, and addresses made not to be answered.
const NOBODY = /(?:@|\.)(?:example\.(?:com|org|net)|[a-z0-9-]+\.example|[a-z0-9.-]+\.(?:invalid|test|localhost))$|@users\.noreply\.github\.com$|^noreply@anthropic\.com$|^git@github\.com$/i;
// Account names that are no one's: the words people write in an example path.
const NO_ONE = new Set(['me', 'you', 'user', 'username', 'name', 'yourname', 'shared', 'runner', 'runneradmin', 'claude', 'someone']);

// Each shape: what it is called, how to find it, and (when the pattern alone is too wide) whether a match counts.
export const SHAPES = [
  { kind: 'Social Security number', find: /(?<![\w-])(\d{3})[- ](\d{2})[- ](\d{4})(?![\w-])/g, counts: match => plausibleSsn(match[1], match[2], match[3]) },
  { kind: 'nine-digit number (a Social Security or routing number)', find: /(?<![A-Za-z0-9.+_/=-])(\d{9})(?![A-Za-z0-9+_/=-])/g,
    counts: match => plausibleSsn(match[1].slice(0, 3), match[1].slice(3, 5), match[1].slice(5)) || routingNumber(match[1]) },
  { kind: 'routing number', find: /\b(?:routing|aba|rtn)\s*(?:no\.?|number|num|#)?\s*[:#=]?\s*(\d{9})\b/gi, value: 1 },
  { kind: 'account number', find: /\b(?:account|acct)\.?\s*(?:(?:no\.?|number|num|#)\s*[:#=]?|[:#=])\s*(\d(?:[ -]?\d){5,16})\b/gi, value: 1 },
  { kind: 'licence number', find: /\b(?:licen[sc]e|lic\.|permit|certificate|registration)\s*(?:no\.?|number|num|#)\s*[:#=]?\s*([A-Za-z0-9][A-Za-z0-9-]{4,})/gi, value: 1,
    counts: match => (match[1].match(/\d/g) || []).length >= 3 },
  { kind: 'date of birth', find: new RegExp('\\b(?:d\\.?o\\.?b\\.?|date of birth|birth ?date|birthday|born(?: on)?)\\b[^0-9\\n]{0,16}(' + DATE + ')', 'gi'), value: 1 },
  { kind: 'e-mail address', find: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, counts: match => !NOBODY.test(match[0]) },
  { kind: 'home folder with an account name', find: /\/(?:Users|home)\/([A-Za-z0-9._-]+)(?=\/)/g, counts: match => !NO_ONE.has(match[1].toLowerCase()) },
];

// ---- Your own values. None is kept: only a keyed fingerprint of each. ----
// A value is compared the way it was fingerprinted: its letters and digits only, in lower case. The fingerprint is
// HMAC-SHA256 under a key that is neither in the repository nor in the list (on a Mac it is in the Keychain).
// Returns a function from normalised text to its fingerprint. (HMAC written out, so that the two keyed starting states
// are made once and copied for each of the many windows of a text.)
export function fingerprinter(key) {
  const block = Buffer.alloc(64); (key.length > 64 ? createHash('sha256').update(key).digest() : key).copy(block);
  const inner = createHash('sha256').update(block.map(byte => byte ^ 0x36)).update('never-list v1\n'), outer = createHash('sha256').update(block.map(byte => byte ^ 0x5c));
  return text => outer.copy().update(inner.copy().update(text).digest()).digest('hex');
}

// The ways one value may be written, each normalised. `runs` says how a form must sit in the text: 0, anywhere, even
// inside a longer word or number; n, as n or more whole runs of letters and digits (a short value, or a date: a date's
// digits inside some longer number are not that date).
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function dateForms(value) {
  const iso = value.match(/^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/), us = value.match(/^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/);
  const [year, month, day] = iso ? [iso[1], Number(iso[2]), Number(iso[3])] : us ? [us[3], Number(us[1]), Number(us[2])] : [];
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const two = number => String(number).padStart(2, '0'), months = [...new Set([String(month), two(month)])], days = [...new Set([String(day), two(day)])];
  const names = [MONTHS[month - 1], MONTHS[month - 1].slice(0, 3), ...(month === 9 ? ['sept'] : [])], th = ['', day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th'];
  const forms = new Map(), add = (text, runs) => { if (!forms.has(text) || forms.get(text) > runs) forms.set(text, runs); };
  for (const m of months) for (const d of days) { for (const y of [year, year.slice(2)]) { add(m + d + y, 3); add(d + m + y, 3); } add(year + m + d, 3); }   // 2/29/1980, 29.02.80, 1980-02-29
  add(year + two(month) + two(day), 1); add(two(month) + two(day) + year, 1); add(two(day) + two(month) + year, 1);                                        // 19800229, 02291980
  for (const name of names) for (const d of days) for (const suffix of th) { add(name + d + suffix + year, 3); add(d + suffix + name + year, 3); }          // February 29, 1980; 29th Feb 1980
  return [...forms].map(([text, runs]) => ({ text, runs }));
}
export function formsOf(kind, value) {
  const whole = plain(value);
  if (kind === 'birthdate') { const dates = dateForms(String(value)); if (dates) return dates; }
  return whole.length < 4 ? [] : [{ text: whole, runs: whole.length < 8 ? 1 : 0 }];   // under four: too short to look for without stopping everything
}
// The lines the local list keeps for one value: kind, a tag joining the lines of one value, the form's length, how it
// must sit in the text, its fingerprint. Nothing of the value itself.
const LINE = /^hmac-sha256 ([a-z]+) ([0-9a-f]{6}) (\d+) (\d+) ([0-9a-f]{64})$/;
export function fingerprintsOf(key, kind, value, tag = randomBytes(3).toString('hex')) {
  const sign = fingerprinter(key);
  return formsOf(kind, value).map(form => ['hmac-sha256', kind, tag, form.text.length, form.runs, sign(form.text)].join(' '));
}
// The local list as read: its fingerprints, and the numbers of any lines that are something else (a value in plain
// text, from before the list was kept this way).
export function readLocal(text) {
  const entries = [], plainLines = [];
  String(text || '').split(/\r?\n/).forEach((line, index) => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    const match = line.trim().match(LINE);
    if (match) entries.push({ kind: match[1], tag: match[2], length: Number(match[3]), runs: Number(match[4]), hex: match[5] }); else plainLines.push(index + 1);
  });
  return { entries, plainLines };
}
// Your own values in a piece of text. The text is normalised the same way, and every stretch of it as long as a
// fingerprinted form is fingerprinted and compared: every position for a form that may sit anywhere, whole runs of
// letters and digits for the others.
function ownValues(text, where, { sign, entries }, lineOf) {
  const found = [], seen = new Set(), anywhere = new Map(), whole = new Map();
  for (const entry of entries) { const map = entry.runs ? whole : anywhere; if (!map.has(entry.length)) map.set(entry.length, []); map.get(entry.length).push(entry); }
  const runs = [...text.matchAll(/[A-Za-z0-9]+/g)], size = runs.reduce((sum, run) => sum + run[0].length, 0), at = new Uint32Array(size), starts = new Uint32Array(runs.length);
  let flat = '';
  runs.forEach((run, index) => { starts[index] = flat.length; for (let k = 0; k < run[0].length; k++) at[flat.length + k] = run.index + k; flat += run[0].toLowerCase(); });
  const hit = (entry, from, to) => { const key = from + ' ' + entry.tag; if (seen.has(key)) return; seen.add(key); found.push({ where, line: lineOf(at[from]), kind: 'your ' + entry.kind + ' (on your local list)', shown: mask(text.slice(at[from], at[to] + 1)) }); };
  for (const [length, list] of anywhere) for (let from = 0; from + length <= size; from++) { const hex = sign(flat.slice(from, from + length)); for (const entry of list) if (entry.hex === hex) hit(entry, from, from + length - 1); }
  const longest = Math.max(0, ...whole.keys());
  for (let first = 0; first < runs.length; first++) for (let last = first, length = 0; last < runs.length && length < longest; last++) {
    length += runs[last][0].length;
    const list = (whole.get(length) || []).filter(entry => last - first + 1 >= entry.runs);
    if (!list.length) continue;
    const hex = sign(flat.slice(starts[first], starts[first] + length));
    for (const entry of list) if (entry.hex === hex) hit(entry, starts[first], starts[first] + length - 1);
  }
  return found;
}
const listOf = text => new Set(String(text || '').split(/\r?\n/).map(line => line.replace(/\s+#.*$/, '').trim()).filter(line => line && !line.startsWith('#')).map(plain));

// Everything on the never-list found in a piece of text. `where` says what the text is (a file, a commit message).
export function scanText(text, where, { local = null, invented = new Set() } = {}) {
  const found = [], lineOf = index => text.slice(0, index).split('\n').length;
  for (const shape of SHAPES) for (const match of text.matchAll(shape.find)) {
    const value = match[shape.value ?? 0];
    if (shape.counts && !shape.counts(match)) continue;
    if (invented.has(plain(value)) || invented.has(plain(match[0]))) continue;
    found.push({ where, line: lineOf(match.index), kind: shape.kind, shown: mask(value) });
  }
  if (local?.entries.length) found.push(...ownValues(text, where, local, lineOf));
  return found;
}

// A path that should never be in the repository at all.
export function scanPath(path) {
  if (path === LOCAL) return 'this is your local list of real values; it must stay out of git';
  if (/\.age$/i.test(path)) return 'an encrypted vault or backup file; those live outside the repository';
  if (/(^|\/)Form Filler (Archive|Backups)(\/|$)/i.test(path)) return 'part of the archive or a backup; those live outside the repository';
  return null;
}
// Not text: anything with a zero byte in it, and every picture, document, video or archive by its ending (a PDF can
// be made of plain characters and still be a document).
const DOCUMENT = /\.(?:pdf|png|jpe?g|gif|webp|heic|heif|tiff?|bmp|ico|webm|mp4|m4v|mov|avi|docx?|xlsx?|pptx?|odt|ods|pages|numbers|zip|gz|tgz|tar|7z|eml|msg)$/i;
export const isBinary = (bytes, path = '') => bytes.includes(0) || DOCUMENT.test(path);
// The files someone has said are invented: "sha256  path" a line.
export const readVouched = text => new Map(String(text || '').split(/\r?\n/).map(line => line.match(/^([0-9a-f]{64})\s+(.+)$/)).filter(Boolean).map(match => [match[2], match[1]]));

// One file: its path, then its contents. `pdfText` turns a PDF's bytes into its text (or throws).
export function scanFile(path, bytes, lists, pdfText) {
  const found = [], reason = scanPath(path);
  if (reason) return [{ where: path, line: 0, kind: 'a file that belongs outside the repository', shown: reason }];
  found.push(...scanText(path, path + ' (its name)', lists).map(item => ({ ...item, line: 0 })));
  if (!isBinary(bytes, path)) return found.concat(scanText(bytes.toString('utf8'), path, lists));
  if (lists.vouched.get(path) !== sha256(bytes)) found.push({ where: path, line: 0, kind: 'a picture, PDF or other file that is not text', shown: lists.vouched.has(path) ? 'it changed since it was listed as invented; run: npm run never-list -- vouch "' + path + '"' : 'not listed as invented; if it is, run: npm run never-list -- vouch "' + path + '"' });
  if (/\.pdf$/i.test(path)) {
    try { found.push(...scanText(pdfText(bytes), path + ' (the PDF’s text)', lists)); }
    catch (error) { found.push({ where: path, line: 0, kind: 'a PDF whose text could not be read', shown: 'install poppler (pdftotext) so it can be checked: ' + String(error.message || error).split('\n')[0] }); }
  }
  return found;
}

// ---- From here on: git, the disk and the terminal. ----
const git = (args, options = {}) => execFileSync('git', args, { maxBuffer: 1 << 28, ...options });
const lines0 = buffer => buffer.toString('utf8').split('\0').filter(Boolean);
const pdfTextOf = bytes => { const run = spawnSync('pdftotext', ['-layout', '-', '-'], { input: bytes, maxBuffer: 1 << 28 }); if (run.error || run.status !== 0) throw new Error(run.error?.message || run.stderr?.toString() || 'pdftotext failed'); return run.stdout.toString('utf8'); };
const read = (root, path) => { try { return readFileSync(join(root, path), 'utf8'); } catch { return ''; } };

// The key the fingerprints are made with. It is never in the repository or in the list. On a Mac it is one item in the
// login Keychain, read through the system's own "security" tool; NEVER_LIST_KEY (64 hex characters) stands in for it
// where there is no Keychain, and in the tests. `create` makes the key the first time one is needed.
const KEYCHAIN = ['-s', 'form-filler.never-list', '-a', 'hmac-key'];
export function readKey({ create = false } = {}) {
  const given = process.env.NEVER_LIST_KEY;
  if (given !== undefined) { if (!/^[0-9a-f]{64}$/i.test(given)) throw new Error('NEVER_LIST_KEY is set but is not a key (64 hex characters).'); return Buffer.from(given, 'hex'); }
  if (process.platform !== 'darwin') throw new Error('the key for your own values is kept in the macOS Keychain, which this system does not have. Set NEVER_LIST_KEY, or take ' + LOCAL + ' away.');
  const look = () => spawnSync('security', ['find-generic-password', ...KEYCHAIN, '-w'], { encoding: 'utf8', timeout: 30000 });
  let found = look();
  if (found.status === 44 && create) {
    const key = randomBytes(32).toString('hex');
    // Given to "security -i" on its standard input, not as an argument, so the key is never on a command line where
    // another program could read it.
    spawnSync('security', ['-i'], { input: 'add-generic-password -s form-filler.never-list -a hmac-key -l form-filler-never-list-key -w ' + key + '\n', encoding: 'utf8', timeout: 30000 });
    found = look();
    if (found.status !== 0 || found.stdout.trim() !== key) throw new Error('the key could not be put in the Keychain' + (found.stderr ? ': ' + found.stderr.trim().split('\n')[0] : '.'));
  }
  if (found.status === 0 && /^[0-9a-f]{64}$/.test(found.stdout.trim())) return Buffer.from(found.stdout.trim(), 'hex');
  if (found.status === 44) throw new Error('the key for your own values is not in this Mac’s Keychain (' + LOCAL + ' was made on another computer, or the key was deleted). The values cannot be checked. Take ' + LOCAL + ' away and add them again.');
  if (found.error?.code === 'ETIMEDOUT') throw new Error('the Keychain did not answer within 30 seconds; it may be locked and waiting for you to unlock it.');
  throw new Error('the Keychain would not give the key for your own values' + (found.stderr ? ': ' + found.stderr.trim().split('\n')[0] : '.'));
}
// Everything a scan needs. A local list that still holds a value in plain text stops the gate until it is converted;
// one that holds fingerprints needs the key, and if the key cannot be had the gate stops too (it never skips them).
export function loadLists(root, { key } = {}) {
  const { entries, plainLines } = readLocal(read(root, LOCAL));
  if (plainLines.length) throw new Error(LOCAL + ' holds ' + plainLines.length + ' line(s) that are not fingerprints (a value in plain text). Replace them with: npm run never-list -- convert');
  return { local: entries.length ? { sign: fingerprinter(key ?? readKey()), entries } : null, invented: listOf(read(root, INVENTED)), vouched: readVouched(read(root, VOUCHED)) };
}
const HEAD = '# The never-list: fingerprints of your own values. No value is written here.\n# Each line is HMAC-SHA256 of one way a value may be written (its letters and digits, lower case), under a key kept\n# in the macOS Keychain (item "form-filler.never-list"). Without that key the lines say nothing about the values.\n# A line: kind, a tag joining the lines of one value, the length, how it must sit in the text, the fingerprint.\n# Git ignores this file and the never-list gate refuses to commit it.\n';
// The local list written whole, over what was there: the old bytes are first written over with zeros in place.
function writeLocalFile(root, lines) {
  const file = join(root, LOCAL), next = Buffer.from(HEAD + lines.join('\n') + (lines.length ? '\n' : ''));
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, '', { mode: 0o600 });
  const old = readFileSync(file).length, handle = openSync(file, 'r+');
  try { if (old) { writeSync(handle, Buffer.alloc(old), 0, old, 0); fsyncSync(handle); } ftruncateSync(handle, 0); writeSync(handle, next, 0, next.length, 0); fsyncSync(handle); } finally { closeSync(handle); }
  chmodSync(file, 0o600);
}
const keptLines = root => read(root, LOCAL).split(/\r?\n/).map(line => line.trim()).filter(line => LINE.test(line));

function report(found, what) {
  if (!found.length) return 0;
  const out = ['', 'Never-list gate: stopped. ' + what, ''];
  for (const item of found) out.push('  ' + item.where + (item.line ? ':' + item.line : '') + '  ' + item.kind + '  ' + item.shown);
  out.push('', 'Nothing was committed. Take the value out, or, if it is invented, add it to ' + INVENTED + '.', 'Values are shown by their last four characters only.', '');
  process.stderr.write(out.join('\n'));
  return 1;
}

function ask(question, hidden) {
  return new Promise(resolve => {
    const terminal = Boolean(process.stdin.isTTY), rl = createInterface({ input: process.stdin, output: process.stdout, terminal });
    if (hidden && terminal) rl._writeToOutput = text => { if (text.includes(question)) process.stdout.write(question); };   // what is typed is not shown
    rl.question(question, answer => { rl.close(); if (hidden && terminal) process.stdout.write('\n'); resolve(answer); });
  });
}
async function main(argv) {
  const root = git(['rev-parse', '--show-toplevel']).toString().trim(), [command] = argv;
  const flag = name => argv.includes(name), after = name => argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
  if (command === 'add') {
    if (readLocal(read(root, LOCAL)).plainLines.length) throw new Error(LOCAL + ' still holds a value in plain text. First run: npm run never-list -- convert');
    const kind = (after('--kind') ?? await ask('What kind of value? (' + KINDS.join(', ') + '): ')).trim().toLowerCase();
    if (!KINDS.includes(kind)) throw new Error('the kind must be one of: ' + KINDS.join(', ') + '.');
    const value = await ask('Type the value (it is not shown): ', true);
    if (process.stdin.isTTY && value !== await ask('Type it once more: ', true)) throw new Error('the two did not match; nothing was added.');
    const lines = fingerprintsOf(readKey({ create: true }), kind, value);
    if (!lines.length) throw new Error('that is too short to look for (fewer than four letters or digits); nothing was added.');
    writeLocalFile(root, [...keptLines(root), ...lines]);
    process.stdout.write('Added one ' + kind + ' (' + plain(value).length + ' letters and digits). Its fingerprint is in ' + LOCAL + '; the value itself is kept nowhere.\n');
    return 0;
  }
  if (command === 'remove') {
    const value = await ask('Type the value to take off the list (it is not shown): ', true), sign = fingerprinter(readKey()), kept = keptLines(root);
    const gone = new Set(KINDS.flatMap(kind => formsOf(kind, value)).map(form => sign(form.text))), tags = new Set(kept.filter(line => gone.has(line.match(LINE)[5])).map(line => line.match(LINE)[2]));
    if (tags.size) writeLocalFile(root, kept.filter(line => !tags.has(line.match(LINE)[2])));
    process.stdout.write(tags.size ? 'Taken off the list: ' + tags.size + ' value' + (tags.size === 1 ? '' : 's') + '.\n' : 'That value is not on the list; nothing was changed.\n');
    return tags.size ? 0 : 1;
  }
  if (command === 'convert') {
    // A list from before values were fingerprinted: each "kind: value" line becomes fingerprints, and the file is
    // written over. The values are read here, used once, and not shown.
    const old = read(root, LOCAL).split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#') && !LINE.test(line.trim()));
    if (!old.length) { process.stdout.write(LOCAL + ' holds no value in plain text; nothing to convert.\n'); return 0; }
    const key = readKey({ create: true }), lines = [], short = [];
    for (const line of old) {
      const match = line.match(/^\s*([a-z]+)\s*:\s*(.+?)\s*$/i), kind = match && KINDS.includes(match[1].toLowerCase()) ? match[1].toLowerCase() : 'other', made = fingerprintsOf(key, kind, match && kind !== 'other' ? match[2] : line.trim());
      if (made.length) lines.push(...made); else short.push(kind);
    }
    writeLocalFile(root, [...keptLines(root), ...lines]);
    process.stdout.write('Converted ' + (old.length - short.length) + ' value(s) to fingerprints and wrote over ' + LOCAL + '.' + (short.length ? ' Left out as too short to look for: ' + short.length + '.' : '') + ' No value is kept in it now.\n');
    return 0;
  }
  if (command === 'list') {
    const { entries, plainLines } = readLocal(read(root, LOCAL)), values = {};
    for (const entry of entries) (values[entry.kind] ??= new Set()).add(entry.tag);
    process.stdout.write((Object.keys(values).length ? Object.entries(values).map(([kind, tags]) => kind + ': ' + tags.size + ' value' + (tags.size === 1 ? '' : 's')).join('\n') + '\n(fingerprints only: the values themselves are kept nowhere, so they cannot be shown)\n' : 'The local list is empty. Add to it with: npm run never-list -- add\n') +
      (plainLines.length ? 'WARNING: ' + plainLines.length + ' line(s) hold a value in plain text. Run: npm run never-list -- convert\n' : ''));
    return 0;
  }
  if (command === 'vouch') {
    const files = argv.slice(1).filter(arg => !arg.startsWith('--'));
    if (!files.length) throw new Error('which file? npm run never-list -- vouch FILE');
    const kept = readVouched(read(root, VOUCHED));
    for (const file of files) { const path = git(['ls-files', '--full-name', '--cached', '--others', '--', file]).toString().trim().split('\n')[0] || file; kept.set(path, sha256(readFileSync(join(root, path)))); }
    const head = '# Pictures, PDFs and other files that are not text, each listed by someone who says it is invented: no real\n# person, form or document. The never-list gate refuses any such file that is not here. Add one with:\n#   npm run never-list -- vouch FILE\n';
    writeFileSync(join(root, VOUCHED), head + [...kept].sort(([a], [b]) => a < b ? -1 : 1).map(([path, hash]) => hash + '  ' + path).join('\n') + '\n');
    process.stdout.write('Listed as invented: ' + files.join(', ') + '\n');
    return 0;
  }
  if (!['--staged', '--message', '--all', '--history'].some(flag)) {
    const top = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1), end = top.findIndex(line => !line.startsWith('//'));
    process.stdout.write(top.slice(0, end).map(line => line.slice(3)).join('\n') + '\n');
    return command && command !== 'help' && command !== '--help' ? 2 : 0;
  }
  const found = [], notes = [], lists = loadLists(root);
  if (flag('--staged')) {
    for (const path of lines0(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd: root }))) found.push(...scanFile(path, git(['show', ':' + path], { cwd: root }), lists, pdfTextOf));
    // Who the commit says made it. None of your own values may be in the author or the committer line (git's
    // user.name and user.email), or they would be published with the commit.
    if (lists.local) for (const [who, variable] of [['author', 'GIT_AUTHOR_IDENT'], ['committer', 'GIT_COMMITTER_IDENT']]) {
      const ident = git(['var', variable], { cwd: root }).toString().replace(/ \d+ [-+]\d{4}\s*$/, '');
      found.push(...scanText(ident, 'the commit’s ' + who + ' (git’s user.name and user.email)', { local: lists.local }).map(item => ({ ...item, line: 0 })));
    }
    if (!lists.local) notes.push('Never-list gate: your local list is empty, so only the shapes were checked. Add your own values with: npm run never-list -- add');
  }
  if (flag('--message')) found.push(...scanText(readFileSync(after('--message'), 'utf8').split('\n').filter(line => !line.startsWith('#')).join('\n'), 'the commit message', lists));
  if (flag('--all')) for (const path of lines0(git(['ls-files', '-z'], { cwd: root }))) { if (existsSync(join(root, path))) found.push(...scanFile(path, readFileSync(join(root, path)), lists, pdfTextOf)); }
  if (flag('--history')) {
    const range = after('--history'), commits = git(['log', '--format=%H', ...(range && !range.startsWith('--') ? [range] : [])], { cwd: root }).toString().split('\n').filter(Boolean);
    for (const commit of commits) {
      const short = commit.slice(0, 7);
      found.push(...scanText(git(['show', '-s', '--format=%B', commit], { cwd: root }).toString('utf8'), 'commit ' + short + ' (its message)', lists));
      let file = '';
      const added = {};
      for (const line of git(['show', '--format=', '--unified=0', '--no-color', '--no-ext-diff', commit], { cwd: root }).toString('utf8').split('\n')) {
        if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
        else if (line.startsWith('+') && !line.startsWith('+++')) (added[file] ??= []).push(line.slice(1));
      }
      for (const [path, text] of Object.entries(added)) found.push(...scanText(text.join('\n'), 'commit ' + short + ', ' + path, lists).map(item => ({ ...item, line: 0 })));
    }
  }
  for (const note of notes) process.stderr.write(note + '\n');
  return report(found, flag('--staged') ? 'What you are about to commit carries something on the never-list.' : flag('--message') && !flag('--all') ? 'The commit message carries something on the never-list.' : 'The repository carries something on the never-list.');
}

// Run as a program (not imported by a test). Real paths are compared, so a symlinked folder cannot make this a no-op.
const invoked = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (invoked) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => { process.stderr.write('Never-list gate: could not run, so nothing was committed. ' + (error.message || error) + '\n'); process.exit(2); });
}

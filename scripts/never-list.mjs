#!/usr/bin/env node
// The never-list gate. It stops a commit that carries personal information, before the commit exists.
//
// What it looks for:
//   1. Shapes (kept here, in the repository): a Social Security number, a bank routing number, an account, licence
//      or date-of-birth value written after its label, an e-mail address that is not an invented one, a home-folder
//      path with an account name in it. No real value is written in this file.
//   2. Your own values (kept in never-list/local.txt, which git ignores and which never leaves this computer): your
//      name, birthdate, addresses, licence and account numbers. A value is found however it is spaced or punctuated.
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
//   node scripts/never-list.mjs add --kind name --from-git     your name, taken from git's own settings
//   node scripts/never-list.mjs list                what kinds of value the local list holds (masked)
//   node scripts/never-list.mjs vouch FILE...       say that a picture, PDF or video is invented
//
// Exit 0: clean. Exit 1: something was found, nothing was committed. Exit 2: the gate could not run (also blocks).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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

// One of your own values as something to search for. A number is found whatever separates its digits; words are found
// whatever separates them and in any case; a birthdate is found in each common way of writing that day.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function dateForms(value) {
  const iso = value.match(/^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/), us = value.match(/^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*$/);
  const [year, month, day] = iso ? [iso[1], Number(iso[2]), Number(iso[3])] : us ? [us[3], Number(us[1]), Number(us[2])] : [];
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const mm = '0?' + month, dd = '0?' + day, yy = '(?:' + year + '|' + year.slice(2) + ')', name = MONTHS[month - 1], word = '(?:' + name + '|' + name.slice(0, 3) + '\\.?)';
  return ['(?<!\\d)' + mm + '[/.-]' + dd + '[/.-]' + yy + '(?!\\d)', '(?<!\\d)' + dd + '[/.-]' + mm + '[/.-]' + yy + '(?!\\d)', '(?<!\\d)' + year + '[/.-]?' + String(month).padStart(2, '0') + '[/.-]?' + String(day).padStart(2, '0') + '(?!\\d)',
    '(?<!\\d)' + String(month).padStart(2, '0') + String(day).padStart(2, '0') + year + '(?!\\d)', word + '\\s+' + dd + '(?:st|nd|rd|th)?,?\\s+' + year, dd + '(?:st|nd|rd|th)?\\s+' + word + ',?\\s+' + year];
}
export function valuePattern(kind, value) {
  const parts = String(value).match(/[A-Za-z0-9]+/g) || [], letters = parts.join('');
  if (letters.length < 4) return null;                                   // too short to search for without blocking everything
  if (kind === 'birthdate') { const forms = dateForms(value); if (forms) return new RegExp(forms.join('|'), 'gi'); }
  const digits = (letters.match(/\d/g) || []).length;
  const body = digits >= 5 && digits >= letters.length * 0.6
    ? [...letters].join('[\\s.()/_-]*')                                  // a number: any separators between its characters
    : parts.join('[^A-Za-z0-9\\n]{0,3}');                                // words: any few separators, or none, between them
  return new RegExp('(?<![A-Za-z0-9])' + body + '(?![A-Za-z0-9])', 'gi');
}

// The local list: one value to a line, "kind: value". Lines starting with # are notes. It is read here and nowhere else.
export function readLocal(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*([a-z]+)\s*:\s*(.+?)\s*$/i), kind = match && KINDS.includes(match[1].toLowerCase()) ? match[1].toLowerCase() : 'other', value = match && kind !== 'other' ? match[2] : line.trim().replace(/^other\s*:\s*/i, '');
    const pattern = valuePattern(kind, value);
    if (pattern) out.push({ kind, pattern, plain: plain(value) });
  }
  return out;
}
const listOf = text => new Set(String(text || '').split(/\r?\n/).map(line => line.replace(/\s+#.*$/, '').trim()).filter(line => line && !line.startsWith('#')).map(plain));

// Everything on the never-list found in a piece of text. `where` says what the text is (a file, a commit message).
export function scanText(text, where, { local = [], invented = new Set() } = {}) {
  const found = [], lineOf = index => text.slice(0, index).split('\n').length;
  for (const shape of SHAPES) for (const match of text.matchAll(shape.find)) {
    const value = match[shape.value ?? 0];
    if (shape.counts && !shape.counts(match)) continue;
    if (invented.has(plain(value)) || invented.has(plain(match[0]))) continue;
    found.push({ where, line: lineOf(match.index), kind: shape.kind, shown: mask(value) });
  }
  for (const own of local) for (const match of text.matchAll(own.pattern)) found.push({ where, line: lineOf(match.index), kind: 'your ' + own.kind + ' (from your local list)', shown: mask(match[0]) });
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
export function loadLists(root) { return { local: readLocal(read(root, LOCAL)), invented: listOf(read(root, INVENTED)), vouched: readVouched(read(root, VOUCHED)) }; }

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
function writeLocal(root, kind, value) {
  if (!valuePattern(kind, value)) throw new Error('that is too short to look for (fewer than four letters or digits).');
  const file = join(root, LOCAL);
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, '# Your own values, one to a line, as "kind: value". This file stays on this computer: git ignores it and the\n# never-list gate refuses to commit it. Kinds: ' + KINDS.join(', ') + '.\n', { mode: 0o600 });
  appendFileSync(file, kind + ': ' + String(value).trim() + '\n');
  chmodSync(file, 0o600);
}

async function main(argv) {
  const root = git(['rev-parse', '--show-toplevel']).toString().trim(), lists = loadLists(root), [command] = argv;
  const flag = name => argv.includes(name), after = name => argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
  if (command === 'add') {
    let kind = after('--kind'), value;
    if (flag('--from-git')) { kind ??= 'name'; value = git(['config', 'user.name']).toString().trim(); }
    else {
      kind ??= (await ask('What kind of value? (' + KINDS.join(', ') + '): ')).trim().toLowerCase();
      if (!KINDS.includes(kind)) throw new Error('the kind must be one of: ' + KINDS.join(', ') + '.');
      value = await ask('Type the value (it is not shown): ', true);
      if (process.stdin.isTTY && value !== await ask('Type it once more: ', true)) throw new Error('the two did not match; nothing was added.');
    }
    writeLocal(root, kind, value);
    process.stdout.write('Added one ' + kind + ' (' + mask(value.trim()) + ') to ' + LOCAL + '. It stays on this computer.\n');
    return 0;
  }
  if (command === 'list') {
    const text = read(root, LOCAL), count = {};
    for (const line of text.split(/\r?\n/)) { const match = line.match(/^\s*([a-z]+)\s*:\s*(.+?)\s*$/i); if (match && !line.trim().startsWith('#')) (count[match[1].toLowerCase()] ??= []).push(mask(match[2])); }
    process.stdout.write(Object.keys(count).length ? Object.entries(count).map(([kind, values]) => kind + ': ' + values.join(', ')).join('\n') + '\n' : 'The local list is empty. Add to it with: npm run never-list -- add\n');
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
  const found = [], notes = [];
  if (flag('--staged')) {
    for (const path of lines0(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd: root }))) found.push(...scanFile(path, git(['show', ':' + path], { cwd: root }), lists, pdfTextOf));
    if (!lists.local.length) notes.push('Never-list gate: your local list is empty, so only the shapes were checked. Add your own values with: npm run never-list -- add');
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
  if (!['--staged', '--message', '--all', '--history'].some(flag)) {
    const top = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1), end = top.findIndex(line => !line.startsWith('//'));
    process.stdout.write(top.slice(0, end).map(line => line.slice(3)).join('\n') + '\n');
    return command && command !== 'help' && command !== '--help' ? 2 : 0;
  }
  for (const note of notes) process.stderr.write(note + '\n');
  return report(found, flag('--staged') ? 'What you are about to commit carries something on the never-list.' : flag('--message') && !flag('--all') ? 'The commit message carries something on the never-list.' : 'The repository carries something on the never-list.');
}

// Run as a program (not imported by a test). Real paths are compared, so a symlinked folder cannot make this a no-op.
const invoked = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (invoked) {
  main(process.argv.slice(2)).then(code => process.exit(code), error => { process.stderr.write('Never-list gate: could not run, so nothing was committed. ' + (error.message || error) + '\n'); process.exit(2); });
}

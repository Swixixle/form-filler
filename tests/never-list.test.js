import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as gate from '../scripts/never-list.mjs';

// The never-list gate, tested on invented values. Every value below that the gate would stop is put together at run
// time (joined from pieces), so this file itself carries none of them and passes the gate it tests.
const repo = fileURLToPath(new URL('..', import.meta.url));
const SSN = ['219', '09', '9999'].join('-'), NINE = SSN.replace(/-/g, ''), ROUTING = ['6660', '0000', '4'].join('');   // 666…: a routing prefix, never a Social Security area
const kinds = (text, lists) => gate.scanText(text, 'x', lists).map(item => item.kind);
const noLists = { local: [], invented: new Set(), vouched: new Map() };

test('shapes: a Social Security number that could be real is stopped, however it is written; one never issued is not', () => {
  assert.deepEqual(kinds('SSN ' + SSN), ['Social Security number']);
  assert.deepEqual(kinds('SSN ' + SSN.replace(/-/g, ' ')), ['Social Security number']);
  assert.deepEqual(kinds('number ' + NINE + '.'), ['nine-digit number (a Social Security or routing number)']);
  for (const never of ['987-65-4321', '000-12-3456', '666-12-3456', '123-00-4567', '123-45-0000']) assert.deepEqual(kinds('SSN ' + never), [], never);
  // Not a number on its own: part of a longer run, a fingerprint, a decimal.
  for (const other of ['id 43981077611', 'sha ' + 'a'.repeat(8) + NINE + 'f', '0.' + NINE, 'v1.2.' + NINE + '-beta']) assert.deepEqual(kinds(other), [], other);
});

test('shapes: routing, account, licence and date-of-birth values after their labels; an e-mail address; a home folder', () => {
  assert.equal(gate.routingNumber(ROUTING), true); assert.equal(gate.routingNumber(ROUTING.slice(0, 8) + '2'), false);
  assert.deepEqual(kinds('wire to ' + ROUTING), ['nine-digit number (a Social Security or routing number)']);
  assert.deepEqual(kinds('Account number: ' + ['0001', '2345', '6789'].join(' ')), ['account number']);
  assert.deepEqual(kinds('acct #' + ['44', '10', '2291'].join('')), ['account number']);
  assert.deepEqual(kinds('an Apple developer account, 12 of them'), []);
  assert.deepEqual(kinds('License No. ' + ['3700', '1234', 'A'].join('')), ['licence number']);
  assert.deepEqual(kinds('licence number shapes are on the list'), []);
  for (const date of [['02', '29', '1980'].join('/'), ['1980', '02', '29'].join('-'), 'February ' + '29, ' + '1980']) assert.deepEqual(kinds('Date of birth: ' + date), ['date of birth'], date);
  assert.deepEqual(kinds('"Date of birth" is one of the labels. Dates written as 11/13/2026'), []);
  assert.deepEqual(kinds('write to ' + ['j.roe', 'mailhost.com'].join('@')), ['e-mail address']);
  assert.deepEqual(kinds('jane@example.org, x@lab.example, a@b.invalid, noreply@anthropic.com, playwright@1.63.0, actions/checkout@v4'), []);
  assert.deepEqual(kinds('saved in ' + ['', 'Users', 'jroe', 'Documents'].join('/') + '/form.pdf'), ['home folder with an account name']);
  assert.deepEqual(kinds('/Users/me/Downloads and /home/runner/work and ~/Downloads'), []);
});

test('your own values: found however they are spaced, cased or punctuated; a birthdate in each way of writing it', () => {
  const local = gate.readLocal(['# a note', 'name: Jane Q Roe', 'account: ' + ['555', '12', '34567'].join('-'), 'birthdate: ' + ['1980', '02', '29'].join('-'), '40 Elm Court Apt 7', 'name: Al'].join('\n'));
  assert.deepEqual(local.map(item => item.kind), ['name', 'account', 'birthdate', 'other'], 'a value too short to look for is left out');
  const found = text => gate.scanText(text, 'x', { local }).map(item => item.kind.split(' ')[1]);
  for (const text of ['by Jane Q Roe', 'janeqroe@', 'JANE  Q.  ROE', 'Jane_Q_Roe.pdf', ['', 'Users', 'janeqroe', 'x'].join('/')]) assert.ok(found(text).includes('name'), text);
  for (const text of ['Janet Q Roe', 'Jane Q Roebuck', 'Jane Roe']) assert.ok(!found(text).includes('name'), text);
  for (const text of ['5551234567', '555 12 34567', '(555) 12-34567', '555.12.34567']) assert.ok(found(text).includes('account'), text);
  assert.ok(!found('15551234567').includes('account'), 'not inside a longer number');
  for (const text of ['02/29/1980', '2/29/80', '29.02.1980', '1980-02-29', '19800229', '02291980', 'February 29, 1980', 'Feb. 29 1980', '29 February 1980', '29th Feb 1980']) assert.ok(found(text).includes('birthdate'), text);
  for (const text of ['02/28/1980', '1980-03-29', '12/29/1980']) assert.ok(!found(text).includes('birthdate'), text);
  assert.ok(found('40 Elm Ct? no: 40 Elm Court, Apt. 7').includes('other'));
});

test('what is reported never shows a whole value: its last four characters only', () => {
  const local = gate.readLocal('name: Jane Q Roe'), report = JSON.stringify(gate.scanText('SSN ' + SSN + ' for Jane Q Roe', 'notes.txt', { local }));
  assert.ok(!report.includes(SSN) && !report.includes('Jane Q Roe'), report);
  assert.ok(report.includes('•••••••9999') && report.includes('•••••• Roe'), report);
  assert.equal(gate.mask('abc'), 'abc'); assert.equal(gate.mask('abcdefgh'), '••••efgh');
});

test('an invented value on the invented list is let through; nothing else with its shape is', () => {
  const invented = new Set([SSN.replace(/-/g, '')]);
  assert.deepEqual(kinds('SSN ' + SSN, { invented }), []);
  assert.deepEqual(kinds('SSN ' + ['219', '09', '9998'].join('-'), { invented }), ['Social Security number']);
});

test('files: a picture or PDF must be listed as invented; a PDF’s text is read; vault, archive and the local list are refused', () => {
  const pdf = readFileSync(new URL('./fixtures/fillable.pdf', import.meta.url)), hash = createHash('sha256').update(pdf).digest('hex');
  const scan = (path, bytes, vouched = new Map(), text = () => 'Visitor Pass Request (invented form)') => gate.scanFile(path, bytes, { ...noLists, vouched }, text);
  assert.match(scan('tests/fixtures/new.pdf', pdf)[0].shown, /not listed as invented/);
  assert.deepEqual(scan('tests/fixtures/new.pdf', pdf, new Map([['tests/fixtures/new.pdf', hash]])), []);
  assert.match(scan('tests/fixtures/new.pdf', pdf, new Map([['tests/fixtures/new.pdf', 'f'.repeat(64)]]))[0].shown, /changed since it was listed/);
  assert.match(scan('scan.png', Buffer.from('not really a picture, but named like one'))[0].kind, /not text/);
  const real = scan('w2.pdf', pdf, new Map([['w2.pdf', hash]]), () => 'Employee SSN ' + SSN);
  assert.deepEqual(real.map(item => [item.where, item.kind]), [['w2.pdf (the PDF’s text)', 'Social Security number']]);
  assert.match(scan('w2.pdf', pdf, new Map([['w2.pdf', hash]]), () => { throw new Error('no pdftotext'); })[0].kind, /could not be read/);
  for (const path of [gate.LOCAL, 'backup/snapshot.tar.age', 'Form Filler Archive/Taxes/2026/record.json']) assert.match(scan(path, Buffer.from('x'))[0].kind, /belongs outside/, path);
  assert.deepEqual(scan('src/lib/vault.js', Buffer.from('export const vault = 1;\n')), []);
  assert.deepEqual(scan('notes ' + SSN + '.txt', Buffer.from('fine')).map(item => item.where), ['notes ' + SSN + '.txt (its name)']);
});

test('in a real repository: the hooks stop a commit, by its contents, its message, an unlisted picture, or the local list itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-never-')), git = (...args) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.org', ...args], { cwd: dir, encoding: 'utf8' });
  for (const part of ['scripts/never-list.mjs', '.githooks']) cpSync(join(repo, part), join(dir, part), { recursive: true });
  mkdirSync(join(dir, 'never-list'));
  writeFileSync(join(dir, gate.INVENTED), ''); writeFileSync(join(dir, gate.VOUCHED), ''); writeFileSync(join(dir, '.gitignore'), gate.LOCAL + '\n');
  writeFileSync(join(dir, gate.LOCAL), 'name: Jane Q Roe\n');
  assert.equal(git('init', '-q').status, 0); assert.equal(git('config', 'core.hooksPath', '.githooks').status, 0);
  const commit = (message, ...paths) => { git('add', ...(paths.length ? paths : ['-A'])); return git('commit', '-q', '-m', message); };

  assert.equal(commit('the gate itself').status, 0, 'a clean commit goes through');
  writeFileSync(join(dir, 'notes.txt'), 'SSN ' + SSN + '\n');
  let out = commit('notes');
  assert.equal(out.status, 1); assert.match(out.stderr, /Never-list gate: stopped/); assert.match(out.stderr, /notes\.txt:1 {2}Social Security number {2}•••••••9999/);
  assert.ok(!out.stderr.includes(SSN), 'the value itself is not printed');
  writeFileSync(join(dir, 'notes.txt'), 'prepared by JANE Q. ROE\n');
  out = commit('notes'); assert.equal(out.status, 1); assert.match(out.stderr, /your name \(from your local list\)/);
  writeFileSync(join(dir, 'notes.txt'), 'the form, filled\n');
  out = commit('filled for Jane Q Roe'); assert.equal(out.status, 1); assert.match(out.stderr, /the commit message/);
  assert.equal(commit('notes').status, 0);

  writeFileSync(join(dir, 'scan.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  out = commit('a picture'); assert.equal(out.status, 1); assert.match(out.stderr, /not listed as invented/);
  assert.equal(spawnSync(process.execPath, ['scripts/never-list.mjs', 'vouch', 'scan.png'], { cwd: dir }).status, 0);
  assert.equal(commit('a picture, listed as invented').status, 0);

  git('add', '-f', gate.LOCAL);
  out = git('commit', '-q', '-m', 'oops'); assert.equal(out.status, 1); assert.match(out.stderr, /your local list of real values/);
  git('reset', '-q');
  // The whole repository and its history, as CI checks them: clean, and the stopped commits never came to exist.
  const all = spawnSync(process.execPath, ['scripts/never-list.mjs', '--all', '--history'], { cwd: dir, encoding: 'utf8' });
  assert.equal(all.status, 0, all.stderr);
  assert.equal(git('rev-list', '--count', 'HEAD').stdout.trim(), '3');
});

test('adding one of your own values: typed in, kept in the local file only, shown masked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-never-'));
  cpSync(join(repo, 'scripts/never-list.mjs'), join(dir, 'scripts/never-list.mjs'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const add = spawnSync(process.execPath, ['scripts/never-list.mjs', 'add', '--kind', 'address'], { cwd: dir, encoding: 'utf8', input: '40 Elm Court Apt 7\n' });
  assert.equal(add.status, 0, add.stderr); assert.ok(!add.stdout.includes('40 Elm'), add.stdout); assert.match(add.stdout, /Added one address \(•+pt 7\)/);
  assert.equal(readFileSync(join(dir, gate.LOCAL), 'utf8').split('\n').filter(line => line && !line.startsWith('#')).join(), 'address: 40 Elm Court Apt 7');
  const list = spawnSync(process.execPath, ['scripts/never-list.mjs', 'list'], { cwd: dir, encoding: 'utf8' });
  assert.match(list.stdout, /^address: •+pt 7$/m);
  assert.equal(spawnSync(process.execPath, ['scripts/never-list.mjs', 'add', '--kind', 'name'], { cwd: dir, input: 'Al\n' }).status, 2, 'too short to look for');
});

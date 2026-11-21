import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { README_TEXT, makeBackup } from '../src/lib/backup.js';
import { readTar } from '../src/lib/tar.js';
import { unlockKey } from '../src/lib/vault.js';
import { nodeFiles } from '../src/lib/files/node.js';
import { DETAILS, PASSPHRASE, clock, hashOf, makeWorld, walk } from './backup-world.js';

// A backup of the invented world (tests/backup-world.js) against the stock tools, so it opens without Form Filler:
// the checksum tool on snapshot.sha256, the system's tar on the snapshot's tar, and the stock age, with the recovery
// key and with the passphrase, by README.txt's own command line. Each test says what it needs, and is skipped where
// that is not installed; CI installs age and sets FF_REQUIRE_AGE, so there a missing age fails instead.
const scratch = mkdtempSync(join(tmpdir(), 'ff-interop-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const has = tool => spawnSync('sh', ['-c', 'command -v ' + tool], { encoding: 'utf8' }).status === 0;
const needsAge = !has('age') && !process.env.FF_REQUIRE_AGE && 'the stock age tool is not installed';
// README.txt's one line for a restore without Form Filler, exactly as it is written there.
const COMMAND = /^ {4}(age -d -i identity\.age .+)$/m.exec(README_TEXT)?.[1];

// One world, one backup, and the snapshot's tar as the library opens it (with the recovery key), shared by the tests.
let ready = null;
const prepared = () => ready ??= (async () => {
  const world = await makeWorld(scratch), drive = mkdtempSync(join(scratch, 'drive-'));
  const made = await makeBackup({ data: nodeFiles(world.data), archive: nodeFiles(world.archive), destination: nodeFiles(drive), now: clock });
  const folder = join(drive, made.path), key = await unlockKey(null, world.recoveryKey);
  const tar = new Uint8Array(await new Response(await key.decrypt(nodeFiles(folder).readStream('snapshot.tar.age'))).arrayBuffer());
  let manifest = null;
  await readTar(new Response(tar).body, async ({ path, pieces }) => { if (path === 'manifest.json') manifest = new Uint8Array(await new Response(pieces).arrayBuffer()); });
  return { world, folder, recipient: key.recipient, tar, manifest, listed: JSON.parse(new TextDecoder().decode(manifest)) };
})();
const copyOf = folder => { const copy = join(mkdtempSync(join(scratch, 'copy-')), 'backup'); cpSync(folder, copy, { recursive: true }); return copy; };

// What a stock tool unpacked must be every member the manifest lists, each file with its SHA-256, and manifest.json
// itself, and nothing else. Names are compared exactly, except on a Mac, whose tar may write an accented letter in
// its other encoding (é as e and an accent): there they are compared in one form, and the test says how many came
// back the other way.
function sameAsManifest(t, folder, { listed, manifest }) {
  const want = new Map(listed.entries.map(entry => entry.kind === 'folder' ? [entry.path + '/', 'folder'] : [entry.path, entry.sha256]));
  want.set('manifest.json', hashOf(manifest));
  const found = walk(folder, { folders: true }), written = new Set([...want.keys()].map(path => path.normalize('NFC')));
  const changed = [...found.keys()].filter(path => !want.has(path) && written.has(path.normalize('NFC')));
  t.diagnostic(changed.length + ' of ' + found.size + ' names came back in another encoding than they were written' + (changed.length ? ', for example ' + JSON.stringify(changed[0]) : '') + ' (' + process.platform + ')');
  const form = map => process.platform === 'darwin' ? new Map([...map].map(([path, value]) => [path.normalize('NFC'), value])) : map;
  assert.deepEqual(form(found), form(want));
}

const sums = [['sha256sum', ['-c', 'snapshot.sha256']], ['shasum', ['-a', '256', '-c', 'snapshot.sha256']]].filter(([tool]) => has(tool));
test('Q. snapshot.sha256 passes the stock checksum tool, run in the backup folder, and a damaged copy fails it (needs sha256sum or shasum)', { skip: !sums.length && 'neither sha256sum nor shasum is installed' }, async () => {
  const { folder } = await prepared(), damaged = copyOf(folder);
  const bytes = readFileSync(join(damaged, 'snapshot.tar.age'));
  bytes[bytes.length - 20] ^= 1;
  writeFileSync(join(damaged, 'snapshot.tar.age'), bytes);
  for (const [tool, args] of sums) {
    const out = spawnSync(tool, args, { cwd: folder, encoding: 'utf8' });
    assert.equal(out.status, 0, tool + ': ' + out.stdout + out.stderr);
    assert.equal(out.stdout, 'snapshot.tar.age: OK\nidentity.age: OK\n', tool + ': both lines say OK');
    const bad = spawnSync(tool, args, { cwd: damaged, encoding: 'utf8' });
    assert.notEqual(bad.status, 0, tool);
    assert.match(bad.stdout, /^snapshot\.tar\.age: FAILED$/m, tool + ': FAILED, as README.txt says');
  }
});

test('R. the system\'s tar unpacks the snapshot\'s tar: every file the manifest lists, with the same SHA-256, and nothing else (needs tar)', { skip: !has('tar') && 'tar is not installed' }, async t => {
  const backup = await prepared(), dir = mkdtempSync(join(scratch, 'tar-'));
  writeFileSync(join(dir, 'snapshot.tar'), backup.tar);
  mkdirSync(join(dir, 'restored'));
  const out = spawnSync('tar', ['-x', '-f', 'snapshot.tar', '-C', 'restored'], { cwd: dir, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  t.diagnostic('tar said: ' + JSON.stringify(out.stderr) + '; ' + spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout.split('\n')[0]);
  sameAsManifest(t, join(dir, 'restored'), backup);
});

test('S. the stock age opens the snapshot with the recovery key, by README.txt\'s own line, and then every vault file but the key file (needs age and tar)', { skip: needsAge }, async t => {
  const backup = await prepared(), dir = copyOf(backup.folder);
  assert.ok(COMMAND, 'README.txt has the line');
  writeFileSync(join(dir, 'key.txt'), '# public key: ' + backup.recipient + '\n' + backup.world.recoveryKey + '\n', { mode: 0o600 });
  const out = spawnSync('sh', ['-c', COMMAND.replace('-i identity.age', '-i key.txt')], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.ok(Buffer.from(backup.tar).equals(readFileSync(join(dir, 'snapshot.tar'))), 'the stock age opens it to the same tar as the library');
  sameAsManifest(t, join(dir, 'restored'), backup);
  const opened = file => { const run = spawnSync('age', ['-d', '-i', 'key.txt', file], { cwd: dir, timeout: 60000 }); assert.equal(run.status, 0, String(run.stderr)); return run.stdout; };
  const profile = JSON.parse(opened('restored/data/vault/profile.age').toString('utf8'));
  assert.deepEqual([profile.formFiller, profile.kind, profile.details], ['vault-record', 'profile', DETAILS], 'profile.age gives the profile record');
  const list = JSON.parse(opened('restored/data/vault/locker/index.age').toString('utf8'));
  assert.deepEqual(list.documents.map(entry => entry.title), ['Invented ID card', 'Invented letter'], 'locker/index.age gives the list');
  const earlier = JSON.parse(opened('restored/data/vault/locker/index.age.prev').toString('utf8'));
  assert.deepEqual(earlier.documents.map(entry => entry.title), ['Invented ID card'], 'locker/index.age.prev gives the list as it was before the second document');
  for (const entry of list.documents) {
    const bytes = opened('restored/data/vault/locker/' + entry.id + '.age');
    assert.deepEqual([bytes.length, hashOf(bytes)], [entry.bytes, entry.sha256], 'each document opens to its exact bytes');
  }
  // README.txt's own line for writing one document to a file, as it is written there.
  const line = /^ {4}(age -d -i identity\.age -o NAME .+)$/m.exec(README_TEXT)?.[1], first = list.documents[0];
  assert.ok(line, 'README.txt has the line');
  const wrote = spawnSync('sh', ['-c', line.replace('-i identity.age', '-i key.txt').replace('NAME', 'document.out').replace('<its id>', first.id)], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  assert.equal(wrote.status, 0, wrote.stdout + wrote.stderr);
  assert.equal(hashOf(readFileSync(join(dir, 'document.out'))), first.sha256, 'it writes the document\'s exact bytes');
});

test('T. the stock age opens the snapshot with the passphrase, by README.txt\'s own line, at a terminal: the key file, identity.age, opened with it (needs age, and Linux for script)', { skip: process.platform !== 'linux' ? 'needs a terminal: part 3 of docs/RESTORE.md, by hand' : needsAge }, async () => {
  const backup = await prepared(), dir = copyOf(backup.folder);
  const out = spawnSync('script', ['-qec', COMMAND, '/dev/null'], { cwd: dir, input: PASSPHRASE + '\n', encoding: 'utf8', timeout: 60000 });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.ok(Buffer.from(backup.tar).equals(readFileSync(join(dir, 'snapshot.tar'))), 'the stock age opens it with the passphrase to the same tar');
});

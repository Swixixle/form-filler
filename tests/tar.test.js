import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tarHeader, writeTar, readTar } from '../src/lib/tar.js';

// The snapshot's tar, on invented names and made-up bytes only. Nothing here touches the disk but its own temporary
// folder, which is removed when the tests are done.
const scratch = mkdtempSync(join(tmpdir(), 'ff-tar-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const M = Math.floor(new Date(2026, 10, 17, 15, 30, 0).getTime() / 1000);
const encoder = new TextEncoder(), text = bytes => new TextDecoder().decode(bytes);
const ascii = bytes => String.fromCharCode(...bytes);
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; };
const made = (length, seed = 1) => Uint8Array.from({ length }, (_, i) => (i * 7919 + seed) % 251);
// A stream of `bytes` in pieces of `size`, one piece each time one is wanted.
const streamOf = (bytes, size = bytes.length || 1) => {
  let at = 0;
  return new ReadableStream({ pull(controller) { if (at >= bytes.length) { controller.close(); return; } controller.enqueue(bytes.subarray(at, at += size)); } }, { highWaterMark: 0 });
};
const collect = async stream => { const parts = [], reader = stream.getReader(); for (;;) { const { done, value } = await reader.read(); if (done) return concat(...parts); parts.push(value); } };
async function* listed(entries) { for (const entry of entries) yield entry; }
const fileOf = (path, bytes, size = bytes.length || 1) => ({ path, kind: 'file', size: bytes.length, open: () => streamOf(bytes, size) });
const tarOf = entries => collect(writeTar(listed(entries), { mtime: M }));
const membersOf = async (bytes, size) => {
  const out = [];
  await readTar(streamOf(bytes, size), async ({ path, kind, size: length, pieces }) => { out.push({ path, kind, size: length, bytes: await collect(pieces) }); });
  return out;
};
const octal = (value, digits) => value.toString(8).padStart(digits, '0') + '\0';
// A header block changed by hand, its checksum then made right again, as a tool that wrote it that way would.
const resum = block => {
  block.fill(0x20, 148, 156);
  let sum = 0; for (const byte of block) sum += byte;
  encoder.encodeInto(sum.toString(8).padStart(6, '0') + '\0 ', block.subarray(148, 156));
  return block;
};
const changed = (block, change) => { const copy = block.slice(); change(copy); return resum(copy); };
const named = (block, name) => changed(block, copy => { copy.fill(0, 0, 100); encoder.encodeInto(name, copy.subarray(0, 100)); });
const fileTar = (path, data) => concat(tarHeader({ path, kind: 'file', size: data.length }, { mtime: M }), data, new Uint8Array((512 - data.length % 512) % 512));
const folderTar = path => tarHeader({ path, kind: 'folder' }, { mtime: M });
const END = new Uint8Array(1024);
// A pax header holding exactly these records.
const paxOf = records => {
  const bytes = encoder.encode(records), first = tarHeader({ path: 'é', kind: 'file', size: 0 }, { mtime: M }).subarray(0, 512);
  return concat(changed(first, copy => encoder.encodeInto(octal(bytes.length, 11), copy.subarray(124, 136))), bytes, new Uint8Array((512 - bytes.length % 512) % 512));
};
const refused = (bytes, why, what) => assert.rejects(membersOf(bytes), error => { assert.match(error.message, why, what); assert.equal(error.code, 'EDAMAGED'); return true; });

test('a short file\'s header, field by field, as ustar writes it', () => {
  const header = tarHeader({ path: 'archive/notes.txt', kind: 'file', size: 1000 }, { mtime: M });
  assert.equal(header.length, 512, 'one block, no pax header');
  const field = (at, length) => ascii(header.subarray(at, at + length));
  assert.equal(field(0, 100), 'archive/notes.txt'.padEnd(100, '\0'));
  assert.equal(field(100, 8), '0000644\0');
  assert.equal(field(108, 8), '0000000\0');
  assert.equal(field(116, 8), '0000000\0');
  assert.equal(field(124, 12), octal(1000, 11));
  assert.equal(field(136, 12), octal(M, 11));
  assert.equal(field(156, 1), '0');
  assert.equal(field(157, 100), '\0'.repeat(100), 'no link name');
  assert.equal(field(257, 6), 'ustar\0');
  assert.equal(field(263, 2), '00');
  assert.equal(field(265, 64), '\0'.repeat(64), 'no owner or group name, never the login name');
  assert.equal(field(329, 8), '0000000\0');
  assert.equal(field(337, 8), '0000000\0');
  assert.equal(field(345, 155), '\0'.repeat(155), 'no prefix');
  assert.equal(field(500, 12), '\0'.repeat(12));
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i];
  assert.equal(field(148, 8), sum.toString(8).padStart(6, '0') + '\0 ', 'the checksum: six octal digits, a NUL and a space');
});

test('a folder\'s header: type 5, a trailing "/", size 0 and mode 0755', () => {
  const header = tarHeader({ path: 'archive/_Inbox', kind: 'folder' }, { mtime: M });
  assert.equal(header.length, 512);
  assert.equal(ascii(header.subarray(0, 15)), 'archive/_Inbox/');
  assert.equal(header[15], 0);
  assert.equal(ascii(header.subarray(156, 157)), '5');
  assert.equal(ascii(header.subarray(124, 136)), octal(0, 11));
  assert.equal(ascii(header.subarray(100, 108)), '0000755\0');
});

test('a pax header goes first for a long name, any byte outside plain ASCII, or a size too large for the old header', () => {
  const long = n => 'a/' + 'b'.repeat(n - 2);
  assert.equal(tarHeader({ path: long(100), kind: 'file', size: 1 }, { mtime: M }).length, 512, 'a 100-byte ASCII path fits');
  const over = tarHeader({ path: long(101), kind: 'file', size: 1 }, { mtime: M });
  assert.equal(over.length, 3 * 512, 'a 101-byte one has a pax header and its records first');
  assert.equal(ascii(over.subarray(156, 157)), 'x');
  assert.equal(ascii(over.subarray(0, 10)), 'PaxHeader\0');
  assert.equal(text(over.subarray(512, 512 + 111)), '111 path=' + long(101) + '\n');
  assert.equal(over[512 + 111], 0, 'the records are padded with zeros');
  assert.equal(ascii(over.subarray(1024, 1024 + 100)), long(101).slice(0, 99) + '\0', 'the member\'s own name is a stand-in, cut to fit');
  const accented = tarHeader({ path: 'Rue de l’Été', kind: 'folder' }, { mtime: M });
  assert.equal(accented.length, 3 * 512, 'one byte outside plain ASCII is enough');
  assert.equal(text(accented.subarray(512, 512 + 26)), '26 path=Rue de l’Été/\n', 'a folder keeps its "/" in its pax path');
  assert.equal(ascii(accented.subarray(1024, 1024 + 18)), 'Rue de l_____t__/\0', 'each byte outside plain ASCII is "_" in the stand-in');
  // Each record's length counts its own digits, so it must be right where it gains one: a path of 1, 90 or 989 bytes
  // gives a record of 9, 99 or 999 bytes, and one byte more gives 11, 101 or 1001.
  const pathOf = length => { let path = '\r'; while (path.length < length) path += path.length % 201 === 200 ? '/' : 'p'; return path; };
  const lengths = [];
  for (const bytes of [1, 2, 3, 90, 91, 92, 989, 990, 991]) {
    const path = pathOf(bytes), header = tarHeader({ path, kind: 'file', size: 0 }, { mtime: M });
    const records = header.subarray(512, header.length - 512), length = Number(ascii(records.subarray(0, records.indexOf(0x20))));
    assert.equal(encoder.encode(path).length, bytes);
    assert.equal(text(records.subarray(0, length)), length + ' path=' + path + '\n', 'the record for a ' + bytes + '-byte path');
    assert.ok(records.subarray(length).every(byte => byte === 0));
    assert.equal(parseInt(ascii(header.subarray(124, 135)), 8), length, 'the pax header\'s size is its records\' length');
    lengths.push(length);
  }
  assert.deepEqual(lengths, [9, 11, 12, 99, 101, 102, 999, 1001, 1002]);
  const huge = 8 * 1024 * 1024 * 1024 + 1;
  const big = tarHeader({ path: 'archive/a large scan.tif', kind: 'file', size: huge }, { mtime: M });
  assert.equal(text(big.subarray(512, 512 + 59)), '33 path=archive/a large scan.tif\n' + '19 size=' + huge + '\n' + '\0'.repeat(7));
  assert.equal(ascii(big.subarray(1024 + 124, 1024 + 136)), octal(0, 11), 'the old size field says 0; the pax size is the real one');
});

test('what the writer writes, the reader reads back: folders, files of every awkward size, in pieces of any size', async () => {
  const seventy = made(70000);
  const entries = [
    { path: 'data', kind: 'folder' }, fileOf('data/empty', new Uint8Array(0)), fileOf('data/one block', made(512, 2)), fileOf('data/one block and a byte', made(513, 3)),
    { path: 'archive', kind: 'folder' }, { path: 'archive/Rue de l’Été', kind: 'folder' }, fileOf('archive/Rue de l’Été/café notes.txt', encoder.encode('invented notes')),
    fileOf('archive/📄 scan 1.pdf', seventy, 1), fileOf('archive/📄 scan 3.pdf', seventy, 3), fileOf('archive/📄 scan 64k.pdf', seventy, 65536),
    fileOf('archive/a name with a\rreturn', encoder.encode('r')), { path: 'archive/' + 'é'.repeat(120), kind: 'folder' }, fileOf('archive/' + 'é'.repeat(120) + '/' + 'ü'.repeat(120) + '.pdf', made(1000, 4)),
    // The longest name a Mac's disk holds: 255 letters, here 765 bytes.
    fileOf('archive/' + '€'.repeat(255), made(10, 5)),
  ];
  const tar = await tarOf(entries);
  assert.equal(tar.length % 10240, 0, 'whole records, as tar itself writes');
  assert.ok(tar.subarray(tar.length - 1024).every(byte => byte === 0), 'ending in zero blocks');
  const want = entries.map(entry => entry.kind === 'folder' ? { path: entry.path, kind: 'folder', size: 0, bytes: new Uint8Array(0) } : { path: entry.path, kind: 'file', size: entry.size, bytes: null });
  for (const [index, entry] of entries.entries()) if (entry.kind === 'file') want[index].bytes = await collect(entry.open());
  for (const size of [1, 7, 512, 65536, tar.length]) assert.deepEqual(await membersOf(tar, size), want, 'read in pieces of ' + size);
  // A reader that leaves a member unread, or reads it in part, still gets every member after it.
  const paths = [];
  await readTar(streamOf(tar, 4096), async ({ path, pieces }) => { paths.push(path); if (path.endsWith('64k.pdf')) await pieces.getReader().read(); });
  assert.deepEqual(paths, entries.map(entry => entry.path));
});

test('the writer refuses pieces that are not bytes, a file that gives more or fewer bytes than it said, and bad paths', async () => {
  const pieces = list => () => new ReadableStream({ start(controller) { for (const piece of list) controller.enqueue(piece); controller.close(); } });
  await assert.rejects(tarOf([{ path: 'a', kind: 'file', size: 3, open: pieces([new ArrayBuffer(3)]) }]), /A piece of a is not bytes/);
  await assert.rejects(tarOf([{ path: 'a', kind: 'file', size: 3, open: pieces(['abc']) }]), /A piece of a is not bytes/);
  await assert.rejects(tarOf([{ path: 'archive/f', kind: 'file', size: 4, open: pieces([made(3)]) }]), { code: 'ECHANGED', message: 'archive/f changed while it was being backed up.' });
  await assert.rejects(tarOf([{ path: 'archive/f', kind: 'file', size: 4, open: pieces([made(4), made(1)]) }]), { code: 'ECHANGED' }, 'one byte more, in a piece of its own');
  await assert.rejects(tarOf([{ path: 'archive/f', kind: 'file', size: 4, open: pieces([made(5)]) }]), { code: 'ECHANGED' });
  for (const path of ['/etc/hosts', '../outside', 'a//b', 'a/./b', 'a/', '', 'a\0b', 'x'.repeat(256), 'a/' + '€'.repeat(256), 7]) {
    assert.throws(() => tarHeader({ path, kind: 'file', size: 0 }, { mtime: M }), /Not a path a snapshot can hold/, JSON.stringify(path));
    await assert.rejects(tarOf([{ path, kind: 'folder' }]), /Not a path a snapshot can hold/);
  }
  // When the tar's reader stops, the file being read is stopped, and so are the entries.
  let cancelled = null, returned = false;
  async function* entries() { try { yield { path: 'f', kind: 'file', size: 1 << 20, open: () => new ReadableStream({ pull: controller => controller.enqueue(made(1024)), cancel: reason => { cancelled = reason; } }) }; } finally { returned = true; } }
  const reader = writeTar(entries(), { mtime: M }).getReader();
  await reader.read(); await reader.read();
  await reader.cancel('the disk is full');
  assert.equal(cancelled, 'the disk is full');
  assert.equal(returned, true);
});

test('the reader refuses what the writer never writes, saying which member', async () => {
  const good = concat(folderTar('a'), fileTar('a/b', encoder.encode('bee')), END);
  assert.deepEqual((await membersOf(good)).map(member => member.path), ['a', 'a/b']);
  const second = 512;   // where a/b's header starts
  const flipped = at => { const copy = good.slice(); copy[at] ^= 1; return copy; };
  await refused(flipped(10), /the first member of the tar has a header whose checksum does not match/);
  await refused(flipped(second + 10), /the member after "a" has a header whose checksum does not match/);
  await refused(concat(changed(folderTar('a'), copy => encoder.encodeInto('ustar  ', copy.subarray(257, 264))), END), /does not have a ustar header/);
  for (const [type, why] of [['1', /type "1" \(a hard link\)/], ['2', /type "2" \(a link\)/], ['g', /type "g" \(a global pax header\)/], ['L', /type "L" \(a GNU long name\)/]])
    await refused(concat(changed(fileTar('x', new Uint8Array(0)), copy => { copy[156] = type.charCodeAt(0); }), END), why);
  await refused(concat(changed(fileTar('x', new Uint8Array(0)), copy => { copy.fill(0, 124, 136); copy[124] = 0x80; copy[135] = 3; }), new Uint8Array(512), END), /size written as a base-256 number/);
  await refused(concat(changed(fileTar('x', new Uint8Array(0)), copy => encoder.encodeInto('0000000000x\0', copy.subarray(124, 136))), END), /size that is not an octal number/);
  for (const path of ['/a', 'a/../b', 'a//b']) await refused(concat(folderTar('a'), named(fileTar('a/b', new Uint8Array(0)), path), END), /is not a path inside the snapshot/, path);
  await refused(concat(fileTar('x', encoder.encode('1')), fileTar('x', encoder.encode('2')), END), /"x" comes twice/);
  await refused(concat(folderTar('x'), fileTar('x/y', new Uint8Array(0)), fileTar('x', new Uint8Array(0)), END), /"x" comes twice/, 'a file named as a folder already is');
  await refused(concat(fileTar('a/b', encoder.encode('bee')), END), /"a\/b" comes before its folder/);
  await refused(concat(named(folderTar('a'), 'a'), END), /is a folder whose path does not end in "\/"/);
  assert.deepEqual((await membersOf(concat(paxOf('12 path=abc\n'), fileTar('abc', new Uint8Array(0)), END))).map(member => member.path), ['abc'], 'a well-counted pax record is read');
  await refused(concat(paxOf('16 path=é/../x\n'), fileTar('x', new Uint8Array(0)), END), /"é\/..\/x" is not a path inside the snapshot/, 'a pax path is held to the same rules');
  // A name of 255 letters, as long as a Mac's disk holds, is read; one more letter is not a name any disk holds.
  const longPath = letters => { const value = 'a/' + 'é'.repeat(letters), base = 3 + 'path'.length + encoder.encode(value).length; return (base + 3) + ' path=' + value + '\n'; };
  assert.deepEqual((await membersOf(concat(folderTar('a'), paxOf(longPath(255)), fileTar('a/x', new Uint8Array(0)), END))).map(member => member.path), ['a', 'a/' + 'é'.repeat(255)]);
  await refused(concat(folderTar('a'), paxOf(longPath(256)), fileTar('a/x', new Uint8Array(0)), END), /is not a path inside the snapshot/, 'a name of 256 letters');
  await refused(concat(paxOf('13 path=abc\n'), fileTar('abc', new Uint8Array(0)), END), /pax record that is miscounted/);
  await refused(concat(paxOf('12 path=abcd'), fileTar('abc', new Uint8Array(0)), END), /pax record that is miscounted, or does not end in a new line/);
  await refused(concat(paxOf('13 mtime=123\n'), fileTar('abc', new Uint8Array(0)), END), /pax record "mtime", which Form Filler never writes/);
  await refused(concat(paxOf('12 path=abc\n12 path=abd\n'), fileTar('abc', new Uint8Array(0)), END), /two pax records "path"/);
  await refused(concat(paxOf('12 path=abc\n'), paxOf('12 path=abc\n'), fileTar('abc', new Uint8Array(0)), END), /a pax header followed by another/);
  await refused(concat(paxOf('12 path=abc\n'), END), /a pax header with no member after it/);
  const data = fileTar('x', made(1000));
  await refused(data.subarray(0, 512 + 500), /the tar ends inside "x": it is cut short/);
  await refused(data.subarray(0, 512 + 1010), /the tar ends inside "x": it is cut short/, 'in its padding');
  await refused(concat(fileTar('x', made(10)).map((byte, at) => at === 512 + 11 ? 1 : byte), END), /"x" is padded with bytes that are not zero/);
  await refused(concat(good, Uint8Array.of(1)), /the tar has bytes after its end/);
  await refused(concat(good, new Uint8Array(4096), Uint8Array.of(0, 0, 7)), /the tar has bytes after its end/, 'however far after');
  await refused(concat(folderTar('a'), new Uint8Array(512)), /the tar ends after one end block: it is cut short/);
  await refused(good.subarray(0, 300), /the tar ends before its end blocks: it is cut short/, 'a stream that stops inside a header');
  await refused(folderTar('a'), /the tar ends before its end blocks/, 'or with no end blocks at all');
  // An error from the one reading a member stops the input and comes back as it was.
  let stopped = null;
  const input = new ReadableStream({ start: controller => controller.enqueue(good), cancel: reason => { stopped = reason; } });
  const mine = new Error('the disk is full');
  await assert.rejects(readTar(input, async () => { throw mine; }), error => error === mine);
  assert.equal(stopped, mine);
});

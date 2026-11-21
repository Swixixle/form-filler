// The tar inside a backup's snapshot: a small writer and a strict reader for the part of the POSIX pax format a backup
// needs, written here so a backup depends on no tar library and runs the same on Node's streams and in WebKit. It is
// plain pax, so the stock tools read it too (`tar -x` on any Mac or Linux), with or without Form Filler.
//
// The writer writes folders ("5") and files ("0") and nothing else, each behind a pax header ("x") when its name is
// long or not plain ASCII, or its size is too large for the old header to hold. There are no links, no owners, and no
// modes or dates of a file's own: every member carries the backup's time and a fixed mode. A file must give exactly
// the bytes its header says, or the writer stops (ECHANGED): a file that changed while it was read is never padded or
// cut to fit.
//
// The reader takes only what the writer writes and refuses everything else, naming the member: a link or any other
// type, an absolute path or a "..", a name given twice, a member before its folder, a bad checksum, a member cut short,
// and anything after the end. Each member's bytes come out in pieces of the input, never held whole.
const BLOCK = 512, RECORD = 10240;   // a tar is made of 512-byte blocks; tar itself pads its output to 10240
const MOST = 0o77777777777;          // the largest size or time 11 octal digits hold
const PAX_LIMIT = 8 * 1024;          // bytes in a pax header: the writer's are a path and a size
const PATH_LIMIT = 4096;             // bytes in a whole path
// UTF-16 units in one name (a string's length): the most any disk holds. A Mac's disk takes 255 of them, which can be
// up to 765 bytes; a Linux disk takes 255 bytes, which are never more than 255 units.
const PART_LIMIT = 255;
const encoder = new TextEncoder();
const bytesOf = text => encoder.encode(text).length;
const ascii = bytes => String.fromCharCode(...bytes);
const zero = bytes => bytes.every(byte => byte === 0);
const plain = bytes => bytes.every(byte => byte >= 0x20 && byte <= 0x7e);
const padding = size => (BLOCK - size % BLOCK) % BLOCK;
const changed = path => Object.assign(new Error(path + ' changed while it was being backed up.'), { code: 'ECHANGED' });
// The reader's refusals carry the code a backup reports them with.
const refuse = message => Object.assign(new Error(message), { code: 'EDAMAGED' });

// A path the writer may write: relative, "/"-separated, every part a name a disk could hold.
function checkPath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\0') || bytesOf(path) > PATH_LIMIT
    || path.split('/').some(part => !part || part === '.' || part === '..' || part.length > PART_LIMIT))
    throw new Error('Not a path a snapshot can hold: ' + JSON.stringify(path) + '.');
}

// One pax record, "<len> <key>=<value>\n", where len counts the whole record in bytes, its own digits included.
function record(key, value) {
  const base = 3 + bytesOf(key) + bytesOf(value);
  let length = base + String(base).length;
  while (length !== base + String(length).length) length = base + String(length).length;
  return length + ' ' + key + '=' + value + '\n';
}

// A ustar header block: numbers in zero-padded octal ending in NUL, no owner names, and the checksum (the sum of every
// byte, counting the checksum's own field as spaces) written as six digits, a NUL and a space.
function headerBlock(name, type, size, mtime, mode) {
  const out = new Uint8Array(BLOCK), put = (at, text) => { for (let i = 0; i < text.length; i++) out[at + i] = text.charCodeAt(i); };
  const octal = (value, digits) => value.toString(8).padStart(digits, '0') + '\0';
  out.set(name, 0);
  put(100, octal(mode, 7)); put(108, octal(0, 7)); put(116, octal(0, 7));
  put(124, octal(size, 11)); put(136, octal(mtime, 11));
  out[156] = type.charCodeAt(0);
  put(257, 'ustar\0'); put(263, '00');
  put(329, octal(0, 7)); put(337, octal(0, 7));
  out.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of out) sum += byte;
  put(148, sum.toString(8).padStart(6, '0') + '\0 ');
  return out;
}

// The header bytes for one member: a pax header with its records first when one is needed, then the ustar header.
// Exported for the tests, which check it byte by byte.
export function tarHeader({ path, kind, size = 0 }, { mtime }) {
  checkPath(path);
  if (kind !== 'file' && kind !== 'folder') throw new Error('A snapshot holds files and folders, not ' + JSON.stringify(kind) + ': ' + path + '.');
  if (kind === 'file' && !(Number.isSafeInteger(size) && size >= 0)) throw new Error('Not a size: ' + size + ' (' + path + ').');
  if (!(Number.isSafeInteger(mtime) && mtime >= 0 && mtime <= MOST)) throw new Error('Not a time a tar can hold: ' + mtime + '.');
  const folder = kind === 'folder', name = folder ? path + '/' : path, length = folder ? 0 : size, mode = folder ? 0o755 : 0o644, type = folder ? '5' : '0';
  const bytes = encoder.encode(name), big = length > MOST;
  if (bytes.length <= 100 && plain(bytes) && !big) return headerBlock(bytes, type, length, mtime, mode);
  // A stand-in name for tools that do not read pax: plain ASCII, "_" for any other byte, cut to fit.
  const standIn = encoder.encode(path).map(byte => byte >= 0x20 && byte <= 0x7e ? byte : 0x5f).subarray(0, 99);
  const records = encoder.encode(record('path', name) + (big ? record('size', String(length)) : ''));
  const out = new Uint8Array(BLOCK + records.length + padding(records.length) + BLOCK);
  out.set(headerBlock(encoder.encode('PaxHeader'), 'x', records.length, mtime, 0o644), 0);
  out.set(records, BLOCK);
  out.set(headerBlock(folder ? Uint8Array.of(...standIn, 0x2f) : standIn, type, big ? 0 : length, mtime, mode), out.length - BLOCK);
  return out;
}

// A tar of `entries`, an async iterable of { path, kind: 'folder' } and { path, kind: 'file', size, open() }, where
// open() gives a ReadableStream of the file's bytes. It is read as it is wanted: the next entry is asked for, and the
// next piece of a file read, only when the reader of the tar wants more. A piece of a file is passed on as it came.
// If the tar's reader stops (age or the disk failed further on), the file being read and the entries are stopped too.
export function writeTar(entries, { mtime }) {
  const iterator = entries[Symbol.asyncIterator]();
  let file = null, written = 0, stopped = false;
  const stop = async reason => {
    stopped = true;
    const open = file;
    file = null;
    await open?.reader.cancel(reason).catch(() => {});
    await iterator.return?.().catch(() => {});
  };
  return new ReadableStream({
    async pull(controller) {
      try {
        for (;;) {
          if (stopped) return;
          if (file) {
            const { done, value } = await file.reader.read();
            if (stopped) return;
            if (!done) {
              if (!(value instanceof Uint8Array)) throw new Error('A piece of ' + file.path + ' is not bytes (a Uint8Array).');
              if (value.length > file.left) throw changed(file.path);
              if (!value.length) continue;
              file.left -= value.length;
              written += value.length;
              controller.enqueue(value);
              return;
            }
            if (file.left) throw changed(file.path);
            const pad = padding(file.size);
            file = null;
            if (pad) { written += pad; controller.enqueue(new Uint8Array(pad)); return; }
          }
          const next = await iterator.next();
          if (stopped) return;
          if (next.done) {
            // Two zero blocks end it, then zeros up to a whole record, as tar itself writes.
            const end = 2 * BLOCK + (RECORD - (written + 2 * BLOCK) % RECORD) % RECORD;
            written += end;
            controller.enqueue(new Uint8Array(end));
            controller.close();
            return;
          }
          const entry = next.value, header = tarHeader(entry, { mtime });
          if (entry.kind === 'file') file = { path: entry.path, size: entry.size, left: entry.size, reader: entry.open().getReader() };
          written += header.length;
          controller.enqueue(header);
          return;
        }
      } catch (error) { await stop(error); throw error; }
    },
    cancel: reason => stop(reason),
  }, { highWaterMark: 1 });
}

// The tar's bytes, as pieces of its input: a part of the piece at hand, or whole blocks gathered for a header.
function source(stream) {
  const reader = stream.getReader();
  let piece = new Uint8Array(0), at = 0, ended = false;
  const take = async most => {
    while (at >= piece.length) {
      if (ended) return null;
      const { done, value } = await reader.read();
      if (done) { ended = true; return null; }
      if (!(value instanceof Uint8Array)) throw new Error('A piece of the tar is not bytes (a Uint8Array).');
      piece = value;
      at = 0;
    }
    const part = piece.subarray(at, Math.min(piece.length, at + most));
    at += part.length;
    return part;
  };
  return {
    // Up to `most` bytes, or null once the input has ended.
    take,
    // Exactly `count` bytes in one array, or null if the input ends first.
    async gather(count) {
      const out = new Uint8Array(count);
      for (let got = 0; got < count;) {
        const part = await take(count - got);
        if (!part) return null;
        out.set(part, got);
        got += part.length;
      }
      return out;
    },
    cancel: reason => reader.cancel(reason).catch(() => {}),
  };
}

// The numbers in a header: octal digits, after any spaces, ended by a NUL or a space. A base-256 number (the high bit
// set) is refused: the writer never writes one.
function octalAt(block, at, length, field, where) {
  const bytes = block.subarray(at, at + length);
  if (bytes[0] & 0x80) throw refuse(where() + ' has its ' + field + ' written as a base-256 number, which Form Filler never writes');
  let i = 0;
  while (i < length && bytes[i] === 0x20) i++;
  const start = i;
  while (i < length && bytes[i] >= 0x30 && bytes[i] <= 0x37) i++;
  if (i === start || i === length || bytes.subarray(i).some(byte => byte !== 0 && byte !== 0x20)) throw refuse(where() + ' has a ' + field + ' that is not an octal number');
  return parseInt(ascii(bytes.subarray(start, i)), 8);
}

// One header block, checked: its checksum, the ustar magic and version, every number, and no prefix.
function readHeader(block, where) {
  const stored = octalAt(block, 148, 8, 'checksum', where);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];
  if (stored !== sum) throw refuse(where() + ' has a header whose checksum does not match: it is damaged');
  if (ascii(block.subarray(257, 263)) !== 'ustar\0' || ascii(block.subarray(263, 265)) !== '00') throw refuse(where() + ' does not have a ustar header');
  if (!zero(block.subarray(345, 500))) throw refuse(where() + ' has a name prefix, which Form Filler never writes');
  for (const [at, length, field] of [[100, 8, 'mode'], [108, 8, 'owner'], [116, 8, 'group'], [136, 12, 'time'], [329, 8, 'device number'], [337, 8, 'device number']]) octalAt(block, at, length, field, where);
  const size = octalAt(block, 124, 12, 'size', where), name = block.subarray(0, 100), end = name.indexOf(0);
  return { type: String.fromCharCode(block[156]), name: end < 0 ? name : name.subarray(0, end), size };
}

// A pax header's records, read by their lengths: only "path" (valid UTF-8) and "size" (a whole number), each once.
function readPax(bytes, where) {
  const found = {}, utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  for (let at = 0; at < bytes.length;) {
    let space = at;
    while (space < bytes.length && bytes[space] >= 0x30 && bytes[space] <= 0x39) space++;
    const length = Number(ascii(bytes.subarray(at, space))), end = at + length;
    if (space === at || bytes[space] !== 0x20 || end > bytes.length || end <= space + 2 || bytes[end - 1] !== 0x0a)
      throw refuse(where() + ' has a pax record that is miscounted, or does not end in a new line');
    const body = bytes.subarray(space + 1, end - 1), equals = body.indexOf(0x3d);
    const key = equals > 0 ? ascii(body.subarray(0, equals)) : '', value = body.subarray(equals + 1);
    if (key !== 'path' && key !== 'size') throw refuse(where() + ' has a pax record ' + JSON.stringify(key) + ', which Form Filler never writes');
    if (key in found) throw refuse(where() + ' has two pax records ' + JSON.stringify(key));
    if (key === 'path') {
      try { found.path = utf8.decode(value); } catch { throw refuse(where() + ' has a pax path that is not UTF-8'); }
    } else {
      const digits = ascii(value);
      if (!/^\d+$/.test(digits) || Number(digits) > Number.MAX_SAFE_INTEGER) throw refuse(where() + ' has a pax size that is not a whole number');
      found.size = Number(digits);
    }
    at = end;
  }
  return found;
}

const TYPES = { 1: 'a hard link', 2: 'a link', 3: 'a device', 4: 'a device', 6: 'a pipe', 7: 'a contiguous file', g: 'a global pax header', L: 'a GNU long name', K: 'a GNU long link' };

// The members of a tar, in order: for each, `onEntry({ path, kind, size, pieces })` is awaited, where `pieces` is a
// ReadableStream of exactly `size` bytes, made of pieces of the input. Whatever it leaves unread is read past. It
// resolves once the input has ended where a tar ends; any refusal is an Error saying which member, and an error from
// `onEntry` stops the input and is thrown as it is.
export async function readTar(stream, onEntry) {
  const input = source(stream), seen = new Set(), folders = new Set();
  let last = null, pax = null;
  const where = () => last === null ? 'the first member of the tar' : 'the member after "' + last + '"';
  const cut = what => refuse('the tar ends inside ' + what + ': it is cut short');
  const skipPadding = async (size, what) => {
    for (let left = padding(size); left;) {
      const part = await input.take(left);
      if (!part) throw cut(what);
      if (!zero(part)) throw refuse(what + ' is padded with bytes that are not zero');
      left -= part.length;
    }
  };
  try {
    for (;;) {
      const block = await input.gather(BLOCK);
      if (!block) throw refuse('the tar ends before its end blocks: it is cut short');
      if (zero(block)) {
        if (pax) throw refuse(where() + ' is a pax header with no member after it');
        const second = await input.gather(BLOCK);
        if (!second) throw refuse('the tar ends after one end block: it is cut short');
        if (!zero(second)) throw refuse('the tar has a block after its first end block that is not zero');
        for (let part; (part = await input.take(RECORD));) if (!zero(part)) throw refuse('the tar has bytes after its end');
        return;
      }
      const header = readHeader(block, where);
      if (header.type === 'x') {
        if (pax) throw refuse(where() + ' is a pax header followed by another');
        if (header.size > PAX_LIMIT) throw refuse(where() + ' has a pax header too large to be one Form Filler writes');
        const records = await input.gather(header.size);
        if (!records) throw cut('a pax header');
        await skipPadding(header.size, 'a pax header');
        pax = readPax(records, where);
        continue;
      }
      if (!['0', '\0', '5'].includes(header.type)) throw refuse(where() + ' is of type ' + JSON.stringify(header.type) + (TYPES[header.type] ? ' (' + TYPES[header.type] + ')' : '') + ', which Form Filler never writes');
      if (!pax?.path && !plain(header.name)) throw refuse(where() + ' has a name that is not plain ASCII and no pax path');
      const folder = header.type === '5', size = pax?.size ?? header.size;
      let path = pax?.path ?? ascii(header.name);
      const named = '"' + path + '"';
      if (folder && size) throw refuse('the folder ' + named + ' has a size');
      if (folder !== path.endsWith('/')) throw refuse(named + (folder ? ' is a folder whose path does not end in "/"' : ' is a file whose path ends in "/"'));
      if (folder) path = path.slice(0, -1);
      const parts = path.split('/'), parent = parts.slice(0, -1).join('/');
      if (path.startsWith('/') || path.includes('\0') || bytesOf(path) > PATH_LIMIT || parts.some(part => !part || part === '.' || part === '..' || part.length > PART_LIMIT))
        throw refuse(named + ' is not a path inside the snapshot');
      if (seen.has(path)) throw refuse(named + ' comes twice');
      if (parent && !folders.has(parent)) throw refuse(named + ' comes before its folder');
      seen.add(path);
      if (folder) folders.add(path);
      last = path;
      pax = null;
      // The member's bytes, as they are read; whatever is left unread is read past once onEntry is done.
      let left = size, busy = null;
      const next = async () => {
        const part = await input.take(Math.min(left, 1 << 20));
        if (!part) throw cut(named);
        left -= part.length;
        return part;
      };
      const pieces = new ReadableStream({
        pull: controller => (busy = (async () => {
          if (left) controller.enqueue(await next());
          if (!left) controller.close();
        })()),
      }, { highWaterMark: 0 });
      await onEntry({ path, kind: folder ? 'folder' : 'file', size, pieces });
      if (busy) await busy.catch(() => {});
      while (left) await next();
      await skipPadding(size, named);
    }
  } catch (error) { await input.cancel(error); throw error; }
}

// The archive's file interface over Node's file system, for the tests and the command line (the Mac app will have its
// own, over Tauri's file plugin). The archive and the backups are handed nothing else, so what this cannot do they
// cannot do at all: it reads, lists, makes a file or a folder that does not exist yet, and renames to a name not yet
// taken. It has no delete and no overwrite. The exceptions are three, all Form Filler's own: the index cache in
// .formfiller, which replaceIndex rewrites in one step; the lock in .formfiller, which unlock removes; and a staging
// folder (.ff-staging-<16 hex digits>) that a backup or a restore made to put things together out of sight, which
// discardStaging removes whole once it is given up or emptied. The archive never makes one: a backup stages on the
// drive it is written to, and a restore beside the archive and inside the app's data folder.
//
// Every path is relative to the interface's folder and written with "/". A name that is taken fails with an error
// whose code is "EEXIST", by the disk's own idea of "the same name" (a Mac's disk ignores case, and how an accent is
// encoded), so the archive can try "name (2)" next. Nothing is followed through a link: a link is listed as "other",
// it is never moved or read, and nothing is written through a folder that leads outside the interface's folder.
//
// `links: false` behaves as a disk that cannot give a file a second name (some USB drives do not), for the tests.
import { createHash, randomBytes } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { link, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, rmdir, stat as statOf, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

const taken = path => Object.assign(new Error('The name is taken: ' + path), { code: 'EEXIST' });
// What link() says on a disk that cannot give a file a second name, where the plain way is used instead.
const NO_LINKS = ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK', 'EXDEV'];
const kindOf = info => info.isFile() ? 'file' : info.isDirectory() ? 'folder' : 'other';
const tempName = () => '.ff-new-' + randomBytes(8).toString('hex') + '.tmp';
const STAGING = /^\.ff-staging-[0-9a-f]{16}$/;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const pause = ms => new Promise(done => setTimeout(done, ms));

export function nodeFiles(root, { links = true } = {}) {
  const base = resolve(root);
  const at = path => {
    if (path === '') return base;
    if (typeof path !== 'string' || path.startsWith('/') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..'))
      throw new Error('Not a path inside the archive: ' + JSON.stringify(path));
    return join(base, ...path.split('/'));
  };
  // A folder about to be written in must really be inside the archive, not reached through a link that leads out.
  let realBase;
  const inside = async folder => {
    realBase ??= await realpath(base);
    const real = await realpath(folder);
    if (real !== realBase && !real.startsWith(realBase + sep)) throw new Error('Not inside the archive: ' + folder);
  };
  // Bytes into a new hidden file in `folder`, written through to the disk before anyone can see them by name.
  const staged = async (folder, bytes) => {
    const temp = join(folder, tempName()), handle = await open(temp, 'wx');
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    return temp;
  };
  // An empty file at a name not yet taken, made in one step, that a rename then replaces: how a name is held on a disk
  // without second names, so a stop leaves an empty file or nothing, never half a document.
  const hold = async (full, path) => { const handle = await open(full, 'wx').catch(error => { throw error.code === 'EEXIST' ? taken(path) : error; }); await handle.close(); };
  const linkOr = async (from, to) => { if (!links) throw Object.assign(new Error('no second names here'), { code: 'ENOTSUP' }); await link(from, to); };
  // A hidden file, written whole, given its real name: as a second name (refused if that name is taken) before the
  // hidden name goes; or, on a disk without second names, with the real name held by an empty file that the hidden
  // one is then renamed onto. If it cannot be named, the hidden file goes.
  const named = async (temp, full, path) => {
    try { await linkOr(temp, full); }
    catch (error) {
      if (error.code === 'EEXIST') { await unlink(temp); throw taken(path); }
      if (!NO_LINKS.includes(error.code)) { await unlink(temp); throw error; }
      try { await hold(full, path); } catch (fail) { await unlink(temp); throw fail; }
      await rename(temp, full);
      return;
    }
    await unlink(temp);
  };
  // Form Filler's own folder, made if missing, and refused if it is anything but a plain folder (a link, say).
  const books = async () => {
    const folder = at('.formfiller');
    await mkdir(folder).catch(error => { if (error.code !== 'EEXIST') throw error; });
    if (!(await lstat(folder)).isDirectory()) throw new Error('.formfiller in the archive is not a plain folder.');
    await inside(folder);
    return folder;
  };

  const files = {
    // How long a path inside the archive may be, in bytes: a Mac allows 1024 for the whole path.
    room: 1023 - Buffer.byteLength(base) - 1,
    // The folder's entries, [{ name, kind: "file" | "folder" | "other" }], in name order.
    async list(path) {
      const entries = await readdir(at(path), { withFileTypes: true });
      return entries.map(entry => ({ name: entry.name, kind: entry.isFile() ? 'file' : entry.isDirectory() ? 'folder' : 'other' }))
        .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    },
    // { kind, bytes } for what is at `path`, or null when nothing is.
    async stat(path) {
      try { const info = await lstat(at(path)); return { kind: kindOf(info), bytes: info.isFile() ? info.size : 0 }; }
      catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
    },
    async read(path) { return new Uint8Array(await readFile(at(path))); },
    // The file's bytes as a ReadableStream of Uint8Array pieces, read as they are wanted, so a large file is never held
    // whole. A link is refused (ELOOP), not read through, even one put in a file's place since its folder was listed.
    readStream(path) { return Readable.toWeb(createReadStream(at(path), { flags: constants.O_RDONLY | constants.O_NOFOLLOW, highWaterMark: 1 << 20 })); },
    // The file's SHA-256, read a piece at a time, so a large file is never held in memory whole.
    sha256(path) {
      return new Promise((done, failed) => {
        const hash = createHash('sha256');
        createReadStream(at(path)).on('error', failed).on('data', piece => hash.update(piece)).on('end', () => done(hash.digest('hex')));
      });
    },
    // A new file with these bytes, which appears whole or not at all: the bytes go to a hidden file beside it first,
    // which is then given the real name as a second name (refused if that name is taken) before the hidden name goes.
    // On a disk without second names, the real name is held with an empty file and the hidden one renamed onto it.
    async createFile(path, bytes) {
      const full = at(path), folder = dirname(full);
      await inside(folder);
      await named(await staged(folder, bytes), full, path);
    },
    // A new file from bytes that come as a stream (any async iterable of Uint8Array pieces, a ReadableStream among
    // them), made as createFile makes one: written a piece at a time to a hidden file beside it, through to the disk,
    // then given its name, so it appears whole or not at all. A taken name fails with EEXIST; with second names, that
    // is found only once the bytes are written. If anything fails, the source included, the hidden file goes and the
    // error comes back as it was. Returns { bytes }, how many were written.
    async createFileFrom(path, source) {
      const full = at(path), folder = dirname(full), pieces = source[Symbol.asyncIterator]();
      let temp = null, handle = null, bytes = 0;
      try {
        await inside(folder);
        const hidden = join(folder, tempName());
        handle = await open(hidden, 'wx');
        temp = hidden;
        for (;;) {
          const { done, value } = await pieces.next();
          if (done) break;
          if (!(value instanceof Uint8Array)) throw new Error('A piece of ' + path + ' is not bytes (a Uint8Array).');
          for (let written = 0; written < value.length;) written += (await handle.write(value, written, value.length - written)).bytesWritten;
          bytes += value.length;
        }
        await handle.sync();
        const writing = handle;
        handle = null;
        await writing.close();
      } catch (error) {
        await pieces.return?.().catch(() => {});
        await handle?.close().catch(() => {});
        if (temp) await unlink(temp).catch(() => {});
        throw error;
      }
      await named(temp, full, path);
      return { bytes };
    },
    // A new folder, in a folder that exists.
    async createFolder(path) {
      const full = at(path);
      await inside(dirname(full));
      try { await mkdir(full); } catch (error) { throw error.code === 'EEXIST' ? taken(path) : error; }
    },
    // A file or folder moved to a name not yet taken. A plain rename would silently replace a file there, or an empty
    // folder, so a folder first makes an empty folder at the new name (which fails if the name is taken) and is then
    // renamed onto that, and a file is given the new name as a second name before the old name goes (or, without
    // second names, held with an empty file that the rename replaces). A link is not moved.
    async rename(from, to) {
      const source = at(from), target = at(to), info = await lstat(source);
      await inside(dirname(source)); await inside(dirname(target));
      if (info.isSymbolicLink()) throw new Error('A link is not moved: ' + from);
      if (info.isDirectory()) {
        try { await mkdir(target); } catch (error) { throw error.code === 'EEXIST' ? taken(to) : error; }
        try { await rename(source, target); } catch (error) { await rmdir(target).catch(() => {}); throw error; }
        return;
      }
      try { await linkOr(source, target); }
      catch (error) {
        if (error.code === 'EEXIST') throw taken(to);
        if (!NO_LINKS.includes(error.code)) throw error;
        await hold(target, to);
        await rename(source, target);
        return;
      }
      await unlink(source);
    },
    // A staging folder that a backup or a restore made, removed whole once it is given up or emptied: what is in it
    // goes too (a link in it is removed, never followed). Anything else is refused: the last part of the path must be
    // .ff-staging- and 16 hex digits, and it must be a plain folder, inside this interface's folder.
    async discardStaging(path) {
      const full = at(path);
      if (!STAGING.test(path.slice(path.lastIndexOf('/') + 1)) || !(await lstat(full)).isDirectory()) throw new Error('Not a staging folder Form Filler made: ' + path);
      await inside(full);
      await rm(full, { recursive: true });
    },
    // The index cache, written whole and then put in place of the old one in one step.
    async replaceIndex(bytes) {
      const folder = await books(), index = join(folder, 'index.json'), info = await lstat(index).catch(() => null);
      if (info && !info.isFile()) throw new Error('.formfiller/index.json in the archive is not a plain file.');
      await rename(await staged(folder, bytes), index);
    },
    // Only one program changes an archive at a time. .formfiller/lock is made, in one step, by whoever is about to
    // change it, and removed when they are done; anyone else waits for it (up to `wait` ms). A lock left by a program
    // that stopped (no such process on this computer any more) is taken over.
    async lock({ wait = 10000 } = {}) {
      const folder = await books(), path = join(folder, 'lock'), mine = JSON.stringify({ pid: process.pid, host: hostname(), since: new Date().toISOString() });
      for (const started = Date.now(); ;) {
        try { const handle = await open(path, 'wx'); try { await handle.writeFile(mine); } finally { await handle.close(); } return; }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        const holder = await files.lockHolder();
        if (holder?.stale) { await unlink(path).catch(() => {}); continue; }
        if (Date.now() - started > wait) throw Object.assign(new Error('Another Form Filler is changing this archive' + (holder?.pid ? ' (process ' + holder.pid + ', since ' + holder.since + ')' : '') + '. Try again when it is done.'), { code: 'ELOCKED' });
        await pause(25);
      }
    },
    async unlock() {
      const path = join(at('.formfiller'), 'lock');
      try { if (JSON.parse(await readFile(path, 'utf8')).pid !== process.pid) return; } catch { return; }
      await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    },
    // Who holds the lock: { pid, host, since, stale }, or null when nobody does. Stale: its process is gone (on this
    // computer), or it was never written (left empty by a stop) half a minute ago or more.
    async lockHolder() {
      const path = join(at('.formfiller'), 'lock');
      let text, info;
      try { [text, info] = await Promise.all([readFile(path, 'utf8'), statOf(path)]); } catch { return null; }
      try { const holder = JSON.parse(text); return { ...holder, stale: holder.host === hostname() && !alive(holder.pid) }; }
      catch { return { pid: null, since: info.mtime.toISOString(), stale: Date.now() - info.mtimeMs > 30000 }; }
    },
  };
  return files;
}

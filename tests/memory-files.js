// The archive's file interface in memory, shaped like a Mac's disk: two names that differ only in case, or in how an
// accent is encoded, are one name (a name keeps the form it was made with). The archive's tests try clashes here that
// a Linux disk would never make. `dump()` is the tests' own view, not part of the interface: every file by path,
// with its SHA-256.
import { createHash } from 'node:crypto';

const fault = (code, message) => Object.assign(new Error(message), { code });
const byName = (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export function memoryFiles({ foldCase = true, room } = {}) {
  let holder = null;
  const key = name => foldCase ? name.normalize('NFD').toLowerCase() : name.normalize('NFD');
  const top = { kind: 'folder', name: '', children: new Map() };
  const split = path => {
    if (path === '') return [];
    if (typeof path !== 'string' || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Not a path inside the archive: ' + JSON.stringify(path));
    return path.split('/');
  };
  const find = path => {
    let node = top;
    for (const part of split(path)) { if (node.kind !== 'folder') return null; node = node.children.get(key(part)); if (!node) return null; }
    return node;
  };
  const slot = path => {
    const parts = split(path), folder = find(parts.slice(0, -1).join('/'));
    if (!parts.length || !folder || folder.kind !== 'folder') throw fault('ENOENT', 'No folder for ' + path);
    return { folder, name: parts.at(-1) };
  };
  const files = {
    ...(room ? { room } : {}),
    async lock({ wait = 2000 } = {}) {
      for (const started = Date.now(); holder;) {
        if (Date.now() - started > wait) throw fault('ELOCKED', 'Another Form Filler is changing this archive.');
        await new Promise(done => setTimeout(done, 1));
      }
      holder = { pid: 1, since: new Date().toISOString(), stale: false };
    },
    async unlock() { holder = null; },
    async lockHolder() { return holder; },
    async list(path) {
      const node = find(path);
      if (!node || node.kind !== 'folder') throw fault('ENOENT', 'No folder ' + path);
      return [...node.children.values()].map(child => ({ name: child.name, kind: child.kind })).sort(byName);
    },
    async stat(path) { const node = find(path); return node ? { kind: node.kind, bytes: node.kind === 'file' ? node.bytes.length : 0 } : null; },
    async read(path) { const node = find(path); if (node?.kind !== 'file') throw fault('ENOENT', 'No file ' + path); return node.bytes.slice(); },
    async sha256(path) { return createHash('sha256').update(await files.read(path)).digest('hex'); },
    async createFile(path, bytes) {
      const { folder, name } = slot(path);
      if (folder.children.has(key(name))) throw fault('EEXIST', 'The name is taken: ' + path);
      folder.children.set(key(name), { kind: 'file', name, bytes: new Uint8Array(bytes) });
    },
    async createFolder(path) {
      const { folder, name } = slot(path);
      if (folder.children.has(key(name))) throw fault('EEXIST', 'The name is taken: ' + path);
      folder.children.set(key(name), { kind: 'folder', name, children: new Map() });
    },
    async rename(from, to) {
      const source = slot(from), target = slot(to), node = source.folder.children.get(key(source.name));
      if (!node) throw fault('ENOENT', 'Nothing at ' + from);
      if (target.folder.children.has(key(target.name))) throw fault('EEXIST', 'The name is taken: ' + to);
      const fold = path => split(path).map(key).join('/');
      if ((fold(to) + '/').startsWith(fold(from) + '/')) throw fault('EINVAL', 'Cannot move a folder inside itself: ' + to);
      source.folder.children.delete(key(source.name));
      node.name = target.name;
      target.folder.children.set(key(target.name), node);
    },
    async replaceIndex(bytes) {
      if (!find('.formfiller')) await files.createFolder('.formfiller');
      find('.formfiller').children.set(key('index.json'), { kind: 'file', name: 'index.json', bytes: new Uint8Array(bytes) });
    },
  };
  // Every file by path with its SHA-256; with `folders`, every folder too (as "path/").
  const dump = ({ folders = false } = {}) => {
    const out = new Map();
    const visit = (node, at) => {
      for (const child of node.children.values()) {
        const path = at ? at + '/' + child.name : child.name;
        if (child.kind === 'folder') { if (folders) out.set(path + '/', 'folder'); visit(child, path); }
        else out.set(path, createHash('sha256').update(child.bytes).digest('hex'));
      }
    };
    visit(top, '');
    return out;
  };
  return { files, dump };
}

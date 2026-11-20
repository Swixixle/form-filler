// The archive: one plain folder you own, where every document that comes in or goes out is kept, filed by matter, with
// the exact bytes that moved and a record of how they moved. It reads sensibly in Finder and needs no app to open.
//
//   Form Filler Archive/
//     Taxes/2026/                               a matter: just a folder path
//       2026-11-17 sent IRS - Form 1040/        an item: <date> <received|sent> <counterparty> - <title>
//         original - f1040.pdf                  each file behind a role word
//         filled - f1040.pdf
//         record.json                           what the item is, and each file's SHA-256 (readRecord below)
//         .formfiller/record 1.json             an earlier record.json, kept when the record changed
//     _Inbox/  _Unsorted/                       where things wait; an item nobody filed goes to _Unsorted
//     .formfiller/index.json                    a cache of every record, kept up to date and rebuilt at any time
//
// Two rules are built in, not promised:
// - Never delete. The archive works through a file interface (files/node.js; the Mac app has its own) that has no
//   delete and no overwrite. A name that is taken gets " (2)"; a newer version of a document goes beside the old one;
//   a record that changes is written anew and the old one kept. The only files ever rewritten or removed are Form
//   Filler's own bookkeeping: the index cache, and the lock that lets one program at a time change the archive.
// - Never misfile. Filing takes a matter and a confidence. Nothing guesses yet: an item goes where you put it, and if
//   you put it nowhere, or a later guess is not sure enough, it goes to _Unsorted.
//
// The folders are the truth. You can rearrange them in Finder: rebuildIndex finds each item again by the id in its
// record.json, and verify says what no longer matches, including an item that has left the archive since the index
// last saw it. Hidden names (a Mac's .DS_Store and the like) are not part of the archive and are left out, except
// Form Filler's own .formfiller folders and the hidden files it writes on the way.
import { hex, sha256 } from './hash.js';

export const INBOX = '_Inbox', UNSORTED = '_Unsorted';
// Below this, a guessed matter is not trusted and the item goes to _Unsorted. An item you file yourself has
// confidence 1; nothing guesses yet, and later phases tune this when something does.
export const FILING_THRESHOLD = 0.9;

const BOOKS = '.formfiller', RECORD = 'record.json', STAGING = BOOKS + '/new', INDEX = BOOKS + '/index.json';
const LIMIT = 240;          // bytes of UTF-8 in one name: disks allow 255, and " (999)" must still fit
const MATTER_LIMIT = 400;   // bytes in a matter's path, so its items and their files still fit in a path a disk can open
const DATES = ['created', 'sent', 'received', 'confirmed', 'replied'];
const HEX64 = /^[0-9a-f]{64}$/, ROLE = /^[a-z][a-z ]{0,29}$/, DAY = /^\d{4}-\d{2}-\d{2}/;
const KEPT_RECORD = /^record (new|\d+)/;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const bytesOf = text => encoder.encode(text).length;
const join = (...parts) => parts.filter(part => part).join('/');
const parentOf = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const nameOf = path => path.slice(path.lastIndexOf('/') + 1);
const json = value => encoder.encode(JSON.stringify(value, null, 2) + '\n');
const isTime = value => typeof value === 'string' && DAY.test(value) && !Number.isNaN(Date.parse(value));
const endingOf = name => { const dot = name.lastIndexOf('.'); return dot > 0 && name.length - dot <= 10 ? name.slice(dot) : ''; };
// Two names a Mac's disk would take for one (it ignores case, and how an accent is encoded), near enough.
const fold = text => text.normalize('NFC').toLowerCase();
const byPath = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
const halfWritten = name => /^\.ff-new-[0-9a-f]+\.tmp$/.test(name);
// The characters a person sees, so a long name is never cut through one (a flag, an accented letter, a joined emoji).
const seen = text => typeof Intl?.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(part => part.segment) : [...text];

// A name for a file or folder, made from words that may hold anything: one line; no "/" or ":" (a Mac shows each as
// the other); none of the invisible characters that hide or reverse text (the joiners some scripts spell with are
// kept); nothing hidden (no leading "."); no trailing dots or spaces; and short enough for any disk, cut between
// characters as a person sees them, keeping a file's ending.
export function cleanName(text, { file = false } = {}) {
  let name = String(text ?? '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f​‎‏‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/[/\\:]/g, '-').replace(/\s+/g, ' ').trim().replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!name) name = 'untitled';
  if (bytesOf(name) <= LIMIT) return name;
  const ending = file ? endingOf(name) : '';
  let stem = '';
  for (const piece of seen(name.slice(0, name.length - ending.length))) { if (bytesOf(stem + piece + ending) > LIMIT) break; stem += piece; }
  return (stem.replace(/[.\s]+$/, '') || 'untitled') + ending;
}

// A matter is a folder path you chose ("Taxes/2026", "Work/Acme/Contract 7"), inside the archive. It is checked, not
// cleaned: a matter that is not already a good folder path is refused, never quietly turned into some other folder.
export function matterPath(matter) {
  const text = String(matter ?? '').normalize('NFC');
  const refuse = why => { throw new Error('Not a usable matter: "' + matter + '". ' + why); };
  if (!text.trim()) refuse('Name one, like Taxes/2026.');
  if (text.startsWith('/') || text === '~' || text.startsWith('~/')) refuse('A matter is a folder path inside the archive, like Taxes/2026, not a full path.');
  const parts = text.replace(/\/+$/, '').split('/');
  for (const part of parts) {
    if (!part) refuse('It has an empty folder name ("//").');
    if (part === BOOKS || fold(part) === RECORD) refuse('"' + part + '" is Form Filler\'s own name.');
    const clean = cleanName(part);
    if (part !== clean) refuse('The folder name "' + part + '" would have to be "' + clean + '" instead: '
      + (part.startsWith('.') ? 'a name starting with "." is hidden.' : /[:/\\]/.test(part) ? 'a name cannot hold ":" or "\\".' : 'it has spaces at an end or doubled, an invisible character, or is too long.'));
  }
  if (bytesOf(parts.join('/')) > MATTER_LIMIT) refuse('It is too long (' + bytesOf(parts.join('/')) + ' bytes; ' + MATTER_LIMIT + ' at most) for a disk to hold with the items inside it.');
  return parts.join('/');
}

// A moment in local time with its offset, as records write it: 2026-11-17T15:30:00-05:00.
export function localTime(date) {
  const pad = (value, width = 2) => String(value).padStart(width, '0'), offset = -date.getTimezoneOffset(), size = Math.abs(offset);
  return pad(date.getFullYear(), 4) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':'
    + pad(date.getSeconds()) + (offset < 0 ? '-' : '+') + pad(Math.floor(size / 60)) + ':' + pad(size % 60);
}

// A random id (version 4 UUID) for each item, from the browser's own crypto (Node has it too).
function newId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const digits = hex(bytes);
  return [digits.slice(0, 8), digits.slice(8, 12), digits.slice(12, 16), digits.slice(16, 20), digits.slice(20)].join('-');
}

// A name a record may give one of its files: one plain name in the item's folder, not hidden, not the record itself.
const plainName = name => typeof name === 'string' && name !== '' && !name.includes('/') && !name.includes('\0') && !name.startsWith('.') && name !== RECORD && bytesOf(name) <= 255;

// record.json, read back and checked, so a damaged or hand-edited record is reported with what is wrong instead of
// being trusted:
//   { "formFiller": "archive-record", "version": 1, "id", "matter", "title", "direction": "in" | "out",
//     "counterparty", "channel", "dates": { "created", "sent", "received", "confirmed", "replied" }, "ledger": null,
//     "filing": { "by", "confidence", "reason" }, "form": { "sha256", "answersSha256" } | null,
//     "files": [{ "role", "name", "sha256", "bytes", "added" }], "history": [{ "at", "event", … }] }
// Fields it does not know are kept, so a later version's additions survive an older program changing the record.
export function readRecord(input) {
  const fail = message => { throw new Error('Not a usable record: ' + message + '.'); };
  let data = input;
  if (typeof input === 'string') { try { data = JSON.parse(input); } catch { fail('it is not JSON'); } }
  if (!data || typeof data !== 'object' || data.formFiller !== 'archive-record') fail('it is not a Form Filler archive record');
  if (data.version !== 1) fail('version ' + data.version + ' is not one this program reads');
  for (const [key, what] of [['id', 'its id'], ['matter', 'its matter'], ['title', 'its title'], ['counterparty', 'who it is with'], ['channel', 'how it moved']])
    if (typeof data[key] !== 'string' || !data[key].trim()) fail(what + ' is missing');
  if (!['in', 'out'].includes(data.direction)) fail('its direction is not "in" or "out"');
  if (!data.dates || typeof data.dates !== 'object') fail('it has no dates');
  if (!isTime(data.dates.created)) fail('the date it was made is missing');
  for (const key of DATES.slice(1)) if ((data.dates[key] ?? null) !== null && !isTime(data.dates[key])) fail('dates.' + key + ' is not a date');
  const filing = data.filing;
  if (!filing || typeof filing !== 'object' || typeof filing.confidence !== 'number' || !(filing.confidence >= 0 && filing.confidence <= 1)) fail('its filing has no confidence from 0 to 1');
  if (data.form != null && (typeof data.form !== 'object' || !HEX64.test(data.form.sha256 || ''))) fail('its form fingerprint is not a SHA-256');
  if (!Array.isArray(data.files)) fail('it has no list of files');
  const names = new Set();
  data.files.forEach((file, index) => {
    const what = 'file ' + (index + 1);
    if (!file || typeof file !== 'object') fail(what + ' is not a file');
    if (typeof file.role !== 'string' || !ROLE.test(file.role)) fail(what + ' has no role word');
    if (!plainName(file.name)) fail(what + ' has a name that cannot be a file in the item');
    if (names.has(file.name.normalize('NFC'))) fail(what + ' has the same name as another file');
    names.add(file.name.normalize('NFC'));
    if (!HEX64.test(file.sha256 || '')) fail(what + ' has no SHA-256');
    if (!Number.isInteger(file.bytes) || file.bytes < 0) fail(what + ' has no size');
    if (!isTime(file.added)) fail(what + ' has no date added');
  });
  if (!Array.isArray(data.history) || data.history.some(event => !event || typeof event !== 'object' || typeof event.event !== 'string')) fail('its history is not a list of events');
  return data;
}

// The index cache, read back: null if it is not one, so a damaged index is simply made again.
function readIndex(text) {
  try {
    const data = JSON.parse(text);
    return data && data.formFiller === 'archive-index' && data.version === 1 && Array.isArray(data.items) && data.items.every(item => item && typeof item.id === 'string' && typeof item.path === 'string') ? data : null;
  } catch { return null; }
}

// "name (2)", keeping a file's ending: "filled - f1040 (2).pdf".
const numbered = (name, n, file) => {
  if (n === 1) return name;
  const ending = file ? endingOf(name) : '';
  return name.slice(0, name.length - ending.length) + ' (' + n + ')' + ending;
};
const TAKEN = Object.assign(new Error('taken'), { code: 'EEXIST' });
// Tries the name, then "name (2)", "name (3)"…, and the disk says which is free: on a Mac's disk "Form" and "form"
// are one name, and the disk knows that better than any comparison here.
async function firstFree(make, name, file) {
  for (let n = 1; n <= 999; n++) {
    const candidate = numbered(name, n, file);
    try { await make(candidate); return candidate; } catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  throw new Error('No free name for "' + name + '": 999 tried.');
}

const itemName = (day, direction, counterparty, title) => cleanName(day + ' ' + (direction === 'in' ? 'received' : 'sent') + ' ' + cleanName(counterparty) + ' - ' + cleanName(title));
const fileName = ({ role = 'document', name }) => cleanName(role + ' - ' + cleanName(name, { file: true }), { file: true });

// The items in an index that hold a file with this SHA-256: "have I already got this exact file?"
export const itemsWithFile = (index, fingerprint) => index.items.filter(item => item.files.some(file => file.sha256 === fingerprint));

const checkDocument = document => {
  const { role = 'document', name, bytes } = document || {};
  if (typeof role !== 'string' || !ROLE.test(role)) throw new Error('A role is one or more lowercase words, like "original" or "filled", not "' + role + '".');
  if (!(bytes instanceof Uint8Array)) throw new Error('The file "' + name + '" has no bytes.');
  return { role, name, bytes };
};

// A new item's details checked, without looking at any disk, so a program can refuse it before making anything.
// Returns the matter it will be filed in: the one given, or _Unsorted.
export function checkItem({ matter = null, confidence = 1, title, direction, counterparty, channel = 'hand', dates = {}, form = null, files: documents = [] } = {}) {
  if (!['in', 'out'].includes(direction)) throw new Error('An item is either sent ("out") or received ("in").');
  for (const [value, what] of [[title, 'a title'], [counterparty, 'who it is with (the counterparty)'], [channel, 'how it moved (the channel)']])
    if (typeof value !== 'string' || !value.trim()) throw new Error('An item needs ' + what + '.');
  if (typeof confidence !== 'number' || !(confidence >= 0 && confidence <= 1)) throw new Error('A confidence is a number from 0 to 1.');
  for (const key of DATES.slice(1)) if (dates[key] != null && !isTime(dates[key])) throw new Error('dates.' + key + ' is not a date like 2026-11-17.');
  if (form !== null && !HEX64.test(form?.sha256 || '')) throw new Error('form needs the SHA-256 of the form.');
  if (!Array.isArray(documents)) throw new Error('files is a list of { role, name, bytes }.');
  documents.forEach(checkDocument);
  return matter && confidence >= FILING_THRESHOLD ? matterPath(matter) : UNSORTED;
}

// The archive at the root of `files`, a file interface (files/node.js, or the Mac app's own). `now` is the clock, for
// tests. Operations run one at a time, in the order asked; with a file interface that can lock, the ones that change
// anything also hold the archive's lock, so no other program changes it at the same time.
export function openArchive(files, { now = () => new Date() } = {}) {
  let queue = Promise.resolve();
  const inTurn = work => (...args) => { const run = queue.then(() => work(...args)); queue = run.catch(() => {}); return run; };
  const locked = work => async (...args) => {
    if (typeof files.lock !== 'function') return work(...args);
    await files.lock();
    try { return await work(...args); } finally { await files.unlock(); }
  };
  const stamp = () => localTime(now());
  const room = Number.isFinite(files.room) ? files.room : Infinity;
  const recordAt = async path => readRecord(decoder.decode(await files.read(join(path, RECORD))));
  // An item's path as given (inside the archive, with "/"), and then as the disk spells it.
  const itemPath = path => {
    const clean = String(path ?? '').normalize('NFC').replace(/^\/+|\/+$/g, '');
    if (!clean || clean.split('/').some(part => !part || part.startsWith('.'))) throw new Error('Not an item in this archive: "' + path + '".');
    return clean;
  };
  const itemAt = async path => {
    const item = await realPath(itemPath(path));
    if ((await files.stat(item))?.kind !== 'folder' || (await files.stat(join(item, RECORD)))?.kind !== 'file') throw new Error('Not an item in this archive (no record.json there): "' + path + '".');
    return { item, record: await recordAt(item) };
  };
  // A path that would be longer than the disk can open is refused before anything is written.
  const fits = (...paths) => {
    for (const path of paths) if (bytesOf(path) > room) throw new Error('That would make a path of ' + bytesOf(path) + ' bytes, longer than the disk can open here (' + room + '). Use a shorter matter, title or file name.');
  };
  // The longest paths an item will hold at `folder`: its files, with room for " (999)", and its kept records.
  const longest = (folder, names) => [join(folder, 'record.json'), join(folder, BOOKS, 'record new (999).json'), ...names.map(name => join(folder, numbered(name, 999, true)))];

  // `path` as the disk spells it: each folder that is there, under the name it was made with (a Mac's disk finds
  // "Taxes" for "taxes"). Folders that are not there yet keep the spelling given.
  async function realPath(path) {
    const parts = path.split('/');
    let at = '';
    for (const [index, part] of parts.entries()) {
      if (!(await files.stat(join(at, part)))) return join(at, ...parts.slice(index));
      const entries = await files.list(at), found = entries.find(entry => entry.name === part) || entries.find(entry => fold(entry.name) === fold(part));
      at = join(at, found ? found.name : part);
    }
    return at;
  }
  // Each folder of `path`, made if missing.
  async function folders(path) {
    let at = '';
    for (const part of path.split('/')) {
      at = join(at, part);
      const info = await files.stat(at);
      if (!info) await files.createFolder(at).catch(error => { if (error.code !== 'EEXIST') throw error; });
      else if (info.kind !== 'folder') throw new Error(at + ' is not a folder.');
    }
  }
  // A folder is an item if it holds a record.json, or what is left of one being replaced.
  const isItem = async path => (await files.stat(join(path, RECORD)))?.kind === 'file'
    || ((await files.stat(join(path, BOOKS)))?.kind === 'folder' && (await files.list(join(path, BOOKS))).some(entry => KEPT_RECORD.test(entry.name)));
  // A matter must not pass through an item or a file: an item's place is in a matter, never in an item.
  async function checkMatter(path) {
    let at = '';
    for (const part of path.split('/')) {
      at = join(at, part);
      const info = await files.stat(at);
      if (!info) return;
      if (info.kind !== 'folder') throw new Error(at + ' is not a folder.');
      if (await isItem(at)) throw new Error(at + ' is an item, not a matter.');
    }
  }
  // One document into a folder, behind its role word: "filled - f1040.pdf", or "filled - f1040 (2).pdf" beside an
  // earlier one. A name the item's record already holds counts as taken even if that file is gone from the disk.
  async function putFile(folder, document, at, recorded = new Set()) {
    const { role, name, bytes } = checkDocument(document);
    const placed = await firstFree(async candidate => { if (recorded.has(fold(candidate))) throw TAKEN; await files.createFile(join(folder, candidate), bytes); }, fileName({ role, name }), true);
    return { role, name: placed, sha256: await sha256(bytes), bytes: bytes.length, added: at };
  }

  // A changed record is written anew, beside the old one, as .formfiller/record new.json…
  async function prepareRecord(path, record) {
    readRecord(record);   // never write a record this program would refuse to read back
    const books = join(path, BOOKS);
    await folders(books);
    return firstFree(name => files.createFile(join(books, name), json(record)), 'record new.json', true);
  }
  // …then the old record.json is put away as .formfiller/record 1.json, record 2.json…, and the new one put in its
  // place. A record is never overwritten, and a stop between any two steps leaves something whole that verify reports.
  // A new record an earlier stop left waiting is put away the same way, as an earlier version.
  async function commitRecord(path, fresh) {
    const books = join(path, BOOKS), listing = await files.list(books);
    let n = Math.max(0, ...listing.map(entry => /^record (\d+)\.json$/.exec(entry.name)).filter(Boolean).map(match => Number(match[1]))) + 1;
    const putAway = async from => {
      for (; ; n++) {
        if (n > 99999) throw new Error('No free name for an old record in ' + books + '.');
        try { await files.rename(from, join(books, 'record ' + n + '.json')); n++; return; } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
    };
    for (const entry of listing) if (entry.name !== fresh && /^record new( \(\d+\))?\.json$/.test(entry.name)) await putAway(join(books, entry.name));
    if (await files.stat(join(path, RECORD))) await putAway(join(path, RECORD));
    await files.rename(join(books, fresh), join(path, RECORD));
  }

  const entryOf = (path, record) => ({
    id: record.id, path, matter: parentOf(path), title: record.title, direction: record.direction, counterparty: record.counterparty, channel: record.channel,
    dates: record.dates, files: record.files.map(({ role, name, sha256: fingerprint, bytes }) => ({ role, name, sha256: fingerprint, bytes })),
  });
  const priorIndex = async () => { try { return readIndex(decoder.decode(await files.read(INDEX))); } catch { return null; } };
  // The index kept up to date as each change finishes: the item's entry put in by its id. With no index yet, or one
  // that cannot be read, it is made again from every record.
  async function noteInIndex(entry) {
    const index = await priorIndex();
    if (!index) { await rebuild(); return; }
    const items = [...index.items.filter(item => item.id !== entry.id), entry].sort(byPath);
    await files.replaceIndex(json({ ...index, built: stamp(), items, left: (index.left || []).filter(item => item.id !== entry.id) }));
  }

  // The folders every archive has: _Inbox, _Unsorted and Form Filler's own. Safe to run again.
  async function init() { for (const folder of [INBOX, UNSORTED, BOOKS]) await folders(folder); }

  // A new item. It is put together out of sight, in .formfiller/new/<id>, and moved into its matter in one rename
  // once whole, so a half-made item never sits among the others. Returns { path, record }.
  async function createItem(details = {}) {
    const { confidence = 1, by = 'you', reason = '', title, direction, counterparty, channel = 'hand', dates = {}, form = null, files: documents = [] } = details;
    const wanted = checkItem(details);
    await checkMatter(wanted);
    const where = await realPath(wanted), created = stamp(), id = newId(), staging = join(STAGING, id);
    const day = ((direction === 'in' ? dates.received : dates.sent) || created).slice(0, 10);
    const name = itemName(day, direction, counterparty.trim(), title.trim());
    fits(...longest(join(where, numbered(name, 999, false)), documents.map(fileName)), ...longest(staging, documents.map(fileName)));
    await folders(STAGING);
    await files.createFolder(staging);
    const placed = [];
    for (const document of documents) placed.push(await putFile(staging, document, created));
    const record = {
      formFiller: 'archive-record', version: 1, id, matter: where, title: title.trim(), direction, counterparty: counterparty.trim(), channel: channel.trim(),
      dates: { created, sent: dates.sent ?? null, received: dates.received ?? null, confirmed: dates.confirmed ?? null, replied: dates.replied ?? null },
      ledger: null, filing: { by, confidence, reason }, form: form ? { sha256: form.sha256, answersSha256: form.answersSha256 ?? null } : null,
      files: placed, history: [{ at: created, event: 'created' }],
    };
    readRecord(record);
    await files.createFile(join(staging, RECORD), json(record));
    await folders(where);
    const path = join(where, await firstFree(candidate => files.rename(staging, join(where, candidate)), name, false));
    await noteInIndex(entryOf(path, record));
    return { path, record };
  }

  // A file added to an item, beside what is there. Returns { path, record, file }.
  async function addFile(path, document) {
    const { item, record } = await itemAt(path), at = stamp();
    fits(...longest(item, [fileName(checkDocument(document))]));
    const file = await putFile(item, document, at, new Set(record.files.map(entry => fold(entry.name))));
    const changed = { ...record, files: [...record.files, file], history: [...record.history, { at, event: 'file added', role: file.role, name: file.name }] };
    await commitRecord(item, await prepareRecord(item, changed));
    await noteInIndex(entryOf(item, changed));
    return { path: item, record: changed, file };
  }

  // An item moved to another matter: its folder renamed there (with " (2)" if the name is taken), and the move written
  // in its record, with you as the one who filed it. The moved record is written into the item before the rename, so a
  // stop after the rename is seen as unfinished; and an item already in that matter whose record says otherwise (a
  // move that stopped, or one made in Finder) just has its record brought up to date. Returns { path, record }.
  async function moveItem(path, matter, { by = 'you', confidence = 1, reason = 'moved' } = {}) {
    const { item, record } = await itemAt(path), to = await realPath(matterPath(matter)), from = parentOf(item);
    if (fold(to + '/').startsWith(fold(item) + '/')) throw new Error('An item cannot go inside itself.');
    const moved = { ...record, matter: to, filing: { by, confidence, reason }, history: [...record.history, { at: stamp(), event: 'moved', from: record.matter, to }] };
    if (to === from) {
      if (record.matter === to) return { path: item, record };
      await commitRecord(item, await prepareRecord(item, moved));
      await noteInIndex(entryOf(item, moved));
      return { path: item, record: moved };
    }
    await checkMatter(to);
    fits(...longest(join(to, numbered(nameOf(item), 999, false)), (await files.list(item)).map(entry => entry.name)));
    const fresh = await prepareRecord(item, moved);
    await folders(to);
    const there = join(to, await firstFree(candidate => files.rename(item, join(to, candidate)), nameOf(item), false));
    await commitRecord(there, fresh);
    await noteInIndex(entryOf(there, moved));
    return { path: there, record: moved };
  }

  // The whole archive, from the top. A folder holding a record.json is an item; any other folder is a matter. An
  // item's own folders are looked in too, for an item put inside it in Finder. Also what Form Filler left unfinished
  // (an item being put together when the app stopped, a record half replaced, a file half written), and whatever
  // could not be read, so one locked folder never hides the rest.
  async function scan() {
    const found = { items: [], loose: [], unfinished: [], problems: [] };
    const listed = async path => {
      try { return await files.list(path); } catch (error) { found.problems.push({ path: path || '(the top)', problem: 'it cannot be read (' + (error.code || error.message) + ')' }); return null; }
    };
    const books = async path => {
      const entries = await listed(join(path, BOOKS));
      for (const entry of entries || []) {
        if (halfWritten(entry.name)) found.unfinished.push({ path: join(path, BOOKS, entry.name), what: 'a file half written when the app stopped' });
        else if (path && /^record new( \(\d+\))?\.json$/.test(entry.name)) found.unfinished.push({ path: join(path, BOOKS, entry.name), what: 'a new record not yet put in place of record.json' });
      }
      if (!path && (await files.stat(STAGING))?.kind === 'folder')
        for (const left of (await listed(STAGING)) || []) found.unfinished.push({ path: join(STAGING, left.name), what: 'an item being put together when the app stopped' });
    };
    const visit = async (path, depth, within) => {
      const entries = await listed(path);
      if (!entries) return;
      const has = name => entries.find(entry => entry.name === name);
      const item = Boolean(path) && has(RECORD)?.kind === 'file';
      if (item) found.items.push({ path, entries, within });
      else if (path && has(BOOKS)?.kind === 'folder' && ((await listed(join(path, BOOKS))) || []).some(entry => KEPT_RECORD.test(entry.name))) {
        found.unfinished.push({ path, what: 'an item whose record.json was being replaced; the newest is in its .formfiller folder' });
        return;
      }
      if (has(BOOKS)?.kind === 'folder') await books(path);
      else if (has(BOOKS)) found.problems.push({ path: join(path, BOOKS), problem: 'Form Filler\'s own folder is not a plain folder here (a link?)' });
      for (const entry of entries) {
        const at = join(path, entry.name);
        if (entry.name === BOOKS) continue;
        if (halfWritten(entry.name)) { found.unfinished.push({ path: at, what: 'a file half written when the app stopped' }); continue; }
        if (entry.name.startsWith('.')) continue;
        if (entry.kind === 'folder') {
          if (depth < 64) await visit(at, depth + 1, item ? path : within);
          else found.problems.push({ path: at, problem: 'folders nested too deep to read' });
        } else if (!item && !within) found.loose.push(at + (entry.kind === 'other' ? ' (a link or other special file)' : ''));
      }
    };
    await visit('', 0, null);
    return found;
  }

  // Every item's record, read, with what is wrong said: a record that cannot be read, an id seen twice (a copied
  // item), an item inside another item. Also each item's entries that its record does not list.
  async function records(found, problems) {
    const out = [], ids = new Map(), unreadable = new Set(), items = new Set(found.items.map(entry => entry.path));
    for (const { path, entries, within } of found.items) {
      let record;
      try { record = await recordAt(path); } catch (error) { problems.push({ path, problem: error.message }); unreadable.add(path); continue; }
      if (within) problems.push({ path, problem: 'it is an item inside another item (' + within + '); move it out into a matter' });
      if (ids.has(record.id)) problems.push({ path, problem: 'it has the same record id as ' + ids.get(record.id) + ': a copy of that item?' });
      else ids.set(record.id, path);
      const listed = new Set(record.files.map(file => file.name.normalize('NFC')));
      const extras = entries.filter(entry => entry.name !== RECORD && !entry.name.startsWith('.') && !listed.has(entry.name.normalize('NFC')) && !items.has(join(path, entry.name)))
        .map(entry => join(path, entry.name) + (entry.kind === 'folder' ? '/' : ''));
      out.push({ path, entries, record, extras });
    }
    return { read: out, ids, unreadable };
  }

  // The index cache, made again from every record.json; the matter of each item is where its folder is now. An item
  // the last index had that is not here any more is kept in `left`, so it is not forgotten.
  async function rebuild() {
    const previous = await priorIndex(), found = await scan(), problems = [...found.problems];
    const { read, ids } = await records(found, problems);
    const items = read.map(({ path, record }) => entryOf(path, record)), noticed = stamp(), left = new Map();
    for (const item of [...(previous?.left || []), ...(previous?.items || [])]) if (!ids.has(item.id) && !left.has(item.id)) left.set(item.id, { ...item, noticed: item.noticed || noticed });
    const index = { formFiller: 'archive-index', version: 1, built: noticed, items, left: [...left.values()], notRecorded: [...found.loose, ...read.flatMap(entry => entry.extras)], unfinished: found.unfinished, problems };
    await files.replaceIndex(json(index));
    return index;
  }

  // Every file read again and checked against its record: what is missing, changed, not recorded or unfinished, and
  // any item the index knew that is no longer in the archive. It changes nothing, not even the index. `ok` is false if
  // anything is missing, changed, gone, unfinished or unreadable; files that are there but not recorded are listed
  // and do not count against it.
  async function verify() {
    const found = await scan(), previous = await priorIndex();
    const report = { ok: false, items: 0, files: 0, missing: [], changed: [], gone: [], unrecorded: [...found.loose], unfinished: [...found.unfinished], problems: [...found.problems], notes: [] };
    const { read, ids, unreadable } = await records(found, report.problems);
    for (const { path, entries, record, extras } of read) {
      report.items++;
      const present = new Map(entries.map(entry => [entry.name.normalize('NFC'), entry]));
      for (const file of record.files) {
        report.files++;
        const entry = present.get(file.name.normalize('NFC'));
        if (!entry) { report.missing.push(join(path, file.name)); continue; }
        const at = join(path, entry.name);
        try {
          const info = entry.kind === 'file' ? await files.stat(at) : null;
          if (!info || info.bytes !== file.bytes || await files.sha256(at) !== file.sha256) report.changed.push(at);
        } catch (error) { report.problems.push({ path: at, problem: 'it cannot be read (' + (error.code || error.message) + ')' }); }
      }
      report.unrecorded.push(...extras);
      if (record.matter.normalize('NFC') !== parentOf(path).normalize('NFC')) report.notes.push({ path, note: 'its record says it was filed in ' + record.matter + '; it was moved outside the app' });
    }
    if (previous) {
      const gone = new Map();
      for (const item of [...previous.items, ...(previous.left || [])]) if (!ids.has(item.id) && !unreadable.has(item.path) && !gone.has(item.id)) gone.set(item.id, item);
      report.gone = [...gone.values()].map(item => ({ id: item.id, path: item.path, title: item.title, files: item.files?.length ?? 0 }));
    } else report.notes.push({ path: INDEX, note: 'there is no index yet, so an item taken out of the archive whole cannot be noticed; run "archive index" once' });
    const holder = typeof files.lockHolder === 'function' ? await files.lockHolder() : null;
    if (holder && !holder.stale) report.notes.push({ path: BOOKS + '/lock', note: 'another Form Filler was changing the archive while this ran, so its work may show as unfinished' });
    report.ok = !(report.missing.length || report.changed.length || report.gone.length || report.unfinished.length || report.problems.length);
    return report;
  }

  return {
    init: inTurn(locked(init)), createItem: inTurn(locked(createItem)), addFile: inTurn(locked(addFile)), moveItem: inTurn(locked(moveItem)),
    rebuildIndex: inTurn(locked(rebuild)), verify: inTurn(verify),
    readItem: inTurn(async path => { const { item, record } = await itemAt(path); return { path: item, record }; }),
  };
}

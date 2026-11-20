import test from 'node:test';
import assert from 'node:assert/strict';
import { makeKeeper } from '../src/app/keep.js';
import { memoryStore } from '../src/lib/stores/memory.js';

// The page's keeper: what it keeps of you and when, run here with the vault in memory, an invented earlier version's
// plain copies, a clock and timers the test moves, and (where two tabs are the point) a channel between two keepers.
// scrypt runs at a low work factor so the tests are quick.
const DETAILS = { fullName: 'Jane Roe', email: 'jane@example.org' };
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=';
const passphrase = 'invented horse battery staple';
const MINUTE = 60000;
const text = data => new TextDecoder().decode(data);
function setUp({ legacy = null, store = memoryStore(), channel = null } = {}) {
  const timers = new Map(), drops = [];
  let next = 0, now = 1_000_000, plain = legacy, locks = 0;
  const timer = { set: (run, ms) => { timers.set(++next, { run, ms }); return next; }, clear: id => timers.delete(id) };
  const keeper = makeKeeper({ store, channel, timer, workFactor: 10, clock: () => now, onLock: () => locks++,
    legacy: { read: () => plain, drop: which => { drops.push(which || 'both'); if (!plain) return; if (which === 'signature') plain = { ...plain, signature: null }; else if (which === 'details') plain = { ...plain, details: {} }; else plain = null; } } });
  return { keeper, store, timers, drops, plain: () => plain, locks: () => locks, later: ms => { now += ms; } };
}
const kept = async store => Object.fromEntries(await Promise.all((await store.list()).map(async name => [name, text(await store.get(name))])));
// Two keepers that hear each other, as two tabs do.
function pair() {
  const ears = [[], []];
  const end = side => ({ postMessage: data => { for (const listen of ears[1 - side]) queueMicrotask(() => listen({ data })); }, addEventListener: (kind, listen) => ears[side].push(listen) });
  return [end(0), end(1)];
}
const settle = () => new Promise(done => setTimeout(done, 20));

test('no vault yet: details are only remembered for the page until a passphrase locks them away', async () => {
  const { keeper, store } = setUp();
  assert.equal(keeper.state, 'checking');
  await keeper.start();
  assert.equal(keeper.state, 'none');
  assert.equal(await keeper.save({ details: DETAILS }), 'none', 'nothing kept without a passphrase');
  assert.deepEqual(keeper.details, DETAILS);
  assert.deepEqual(await store.list(), []);
  const recovery = await keeper.create(passphrase);
  assert.deepEqual([keeper.state, keeper.recoveryKey], ['open', recovery]);
  assert.match(recovery, /^AGE-SECRET-KEY-1/);
  const files = await kept(store);
  assert.deepEqual(Object.keys(files), ['identity.age', 'profile.age', 'vault.json']);
  assert.ok(Object.values(files).every(data => !data.includes('Jane')), 'nothing of you in plain text');
  keeper.keptKey();
  assert.equal(keeper.recoveryKey, null, 'shown once');
});

test('locked and unlocked: the details leave memory when locked; a wrong passphrase changes nothing', async () => {
  const { keeper, locks } = setUp();
  await keeper.start();
  await keeper.save({ details: DETAILS });
  await keeper.create(passphrase);
  keeper.keptKey();
  await keeper.save({ signature: SIGNATURE });
  assert.equal(keeper.lock(), true);
  assert.deepEqual([keeper.state, keeper.details, keeper.signature, locks()], ['locked', {}, null, 1]);
  await assert.rejects(keeper.unlock('not the passphrase'), { code: 'EPASSPHRASE' });
  assert.equal(keeper.state, 'locked');
  assert.equal(await keeper.unlock(passphrase), null);
  assert.deepEqual([keeper.state, keeper.details, keeper.signature], ['open', DETAILS, SIGNATURE]);
  await assert.rejects(setUp().keeper.changePassphrase('another invented one'), /Unlock your details first/);
});

test('a new recovery key is not taken away before it is kept: not by Lock now, not by the idle lock', async () => {
  const { keeper, later } = setUp();
  await keeper.start();
  await keeper.create(passphrase);
  assert.equal(keeper.lock(), false, 'Lock now waits for the key to be kept');
  later(60 * MINUTE); keeper.check();
  assert.deepEqual([keeper.state, Boolean(keeper.recoveryKey)], ['open', true], 'nor does an hour left alone');
  keeper.keptKey();
  keeper.check();
  assert.equal(keeper.state, 'locked', 'once kept, the time already gone locks it');
  assert.equal(keeper.recoveryKey, null);
});

test('the idle lock counts the clock, not the timer: 15 minutes left alone lock it, even if the computer slept through them', async () => {
  const { keeper, timers, later } = setUp();
  await keeper.start();
  await keeper.create(passphrase);
  keeper.keptKey();
  assert.equal(timers.size, 1);
  const [first] = timers.keys();
  assert.equal(timers.get(first).ms, 15 * MINUTE);
  later(5 * MINUTE); keeper.touch();
  assert.equal(timers.has(first), false, 'something done: the old count is cleared');
  assert.equal(timers.size, 1, 'and one new one set');
  later(14 * MINUTE); [...timers.values()][0].run();
  assert.equal(keeper.state, 'open', 'a timer that fires early locks nothing');
  later(2 * MINUTE); keeper.check();
  assert.equal(keeper.state, 'locked', 'the page looking again after a sleep');
  keeper.touch();
  assert.equal(timers.size, 0, 'nothing to keep open once locked');
});

test('unlocking and a new passphrase each start the 15 minutes', async () => {
  const { keeper, timers } = setUp();
  await keeper.start();
  await keeper.create(passphrase);
  keeper.keptKey(); keeper.lock();
  assert.equal(timers.size, 0);
  await keeper.unlock(passphrase);
  assert.equal([...timers.values()][0].ms, 15 * MINUTE);
  const before = [...timers.keys()][0];
  await keeper.changePassphrase('another invented passphrase');
  assert.equal(timers.has(before), false); assert.equal(timers.size, 1);
});

test('plain copies an earlier version kept are used until locked away, and are gone the moment they are', async () => {
  const { keeper, store, drops, plain } = setUp({ legacy: { details: DETAILS, signature: SIGNATURE } });
  await keeper.start();
  assert.deepEqual([keeper.state, keeper.legacy, keeper.details, keeper.signature], ['none', true, DETAILS, SIGNATURE]);
  await keeper.create(passphrase);
  assert.deepEqual([keeper.legacy, drops, plain()], [false, ['both'], null]);
  keeper.keptKey(); keeper.lock();
  await keeper.unlock(passphrase);
  assert.deepEqual([keeper.details, keeper.signature], [DETAILS, SIGNATURE], 'locked away, with nothing lost');
  assert.ok(Object.values(await kept(store)).every(data => !data.includes('Jane')));
});

test('plain copies found beside a vault are never used or merged, and forgetting them leaves the vault alone', async () => {
  const store = memoryStore(), first = setUp({ store });
  await first.keeper.start();
  await first.keeper.save({ details: { fullName: 'Jane Roe' } });
  await first.keeper.create(passphrase);
  const later = setUp({ store, legacy: { details: { fullName: 'Someone Else', email: 'planted@example.net' }, signature: SIGNATURE } });
  await later.keeper.start();
  assert.deepEqual([later.keeper.state, later.keeper.legacy, later.keeper.details], ['locked', false, {}]);
  assert.deepEqual(later.keeper.stray.details, { fullName: 'Someone Else', email: 'planted@example.net' });
  await later.keeper.unlock(passphrase);
  assert.deepEqual([later.keeper.details, later.keeper.signature], [{ fullName: 'Jane Roe' }, null], 'the vault\'s own, and nothing planted');
  later.keeper.forgetStray();
  assert.deepEqual([later.keeper.stray, later.plain(), later.drops], [null, null, ['both']]);
  assert.deepEqual(Object.keys(await kept(store)), ['identity.age', 'profile.age', 'vault.json'], 'the vault is as it was');
});

test('"Forget it" forgets the signature everywhere: from the vault, with no earlier copy, and from any plain copy', async () => {
  const legacyOnly = setUp({ legacy: { details: {}, signature: SIGNATURE } });
  await legacyOnly.keeper.start();
  assert.equal(await legacyOnly.keeper.forgetSignature(), 'none');
  assert.deepEqual([legacyOnly.drops, legacyOnly.plain().signature, legacyOnly.keeper.legacy], [['signature'], null, false]);
  const { keeper, store } = setUp();
  await keeper.start();
  await keeper.save({ details: DETAILS, signature: SIGNATURE });
  await keeper.create(passphrase);
  assert.equal(await keeper.forgetSignature(), 'kept');
  assert.deepEqual([keeper.signature, keeper.details], [null, DETAILS]);
  assert.equal(store.dump().has('profile.age.prev'), false, 'no earlier copy that still holds it');
  keeper.keptKey(); keeper.lock();
  await keeper.unlock(passphrase);
  assert.equal(keeper.signature, null);
});

test('a vault made while the browser refuses to save the details still shows its recovery key, and what was typed stays', async () => {
  const inner = memoryStore();
  const store = { ...inner, put: async (name, bytes, options) => { if (name === 'profile.age') throw new Error('the browser refused (quota)'); return inner.put(name, bytes, options); } };
  const { keeper } = setUp({ store });
  await keeper.start();
  await keeper.save({ details: DETAILS });
  await assert.rejects(keeper.create(passphrase), /refused \(quota\)/);
  assert.deepEqual([keeper.state, Boolean(keeper.recoveryKey), keeper.details], ['open', true, DETAILS]);
  await assert.rejects(keeper.save({ details: { ...DETAILS, phone: '555-0100' } }), /refused/);
  assert.equal(keeper.details.phone, '555-0100', 'a refused save keeps what was typed on screen');
});

test('details that cannot be read do not keep the vault shut: it opens empty, and says why', async () => {
  const store = memoryStore(), { keeper } = setUp({ store });
  await keeper.start();
  await keeper.save({ details: DETAILS });
  await keeper.create(passphrase);
  keeper.keptKey(); keeper.lock();
  const damaged = await store.get('profile.age'); damaged[damaged.length - 3] ^= 1;
  await store.put('profile.age', damaged, { prev: false });
  const why = await keeper.unlock(passphrase);
  assert.match(why, /does not open with this vault's key/);
  assert.deepEqual([keeper.state, keeper.details], ['open', {}]);
});

test('two tabs: each hears when the other makes, changes or forgets the vault', async () => {
  const store = memoryStore(), [left, right] = pair();
  const a = setUp({ store, channel: left }), b = setUp({ store, channel: right });
  await a.keeper.start(); await b.keeper.start();
  await a.keeper.save({ details: DETAILS });
  await a.keeper.create(passphrase); a.keeper.keptKey();
  await settle();
  assert.equal(b.keeper.state, 'locked', 'the other tab saw the vault made');
  await b.keeper.unlock(passphrase);
  await a.keeper.save({ details: { ...DETAILS, phone: '555-0100' } });
  await settle();
  assert.equal(b.keeper.details.phone, '555-0100', 'and takes what the first tab saved');
  await a.keeper.forget();
  await settle();
  assert.deepEqual([b.keeper.state, b.keeper.details], ['none', {}], 'and lets go of it when it is forgotten');
});

test('a tab that never heard cannot write over a vault forgotten and made again under it', async () => {
  const shared = memoryStore(), one = setUp({ store: shared }), two = setUp({ store: shared });
  await one.keeper.start(); await one.keeper.create(passphrase); one.keeper.keptKey();
  await two.keeper.start(); await two.keeper.unlock(passphrase);
  await one.keeper.forget(); await one.keeper.save({ details: { fullName: 'New' } }); await one.keeper.create('a new invented passphrase');
  await assert.rejects(two.keeper.save({ details: { fullName: 'Old' } }), { code: 'ECHANGED' });
  assert.equal(two.keeper.state, 'locked');
  const fresh = setUp({ store: shared });
  await fresh.keeper.start();
  await assert.rejects(fresh.keeper.unlock(passphrase), { code: 'EPASSPHRASE' }, 'the old passphrase opens nothing now');
  await fresh.keeper.unlock('a new invented passphrase');
  assert.deepEqual(fresh.keeper.details, { fullName: 'New' }, 'the new vault still opens, with what was saved in it');
});

test('forgetting removes the vault and any plain copies, and starts again from nothing', async () => {
  const { keeper, store, plain } = setUp({ legacy: { details: DETAILS, signature: null } });
  await keeper.start();
  await keeper.forget();
  assert.deepEqual([keeper.state, keeper.legacy, plain()], ['none', false, null], 'plain copies, with no vault');
  await keeper.save({ details: DETAILS });
  await keeper.create(passphrase);
  await keeper.forget();
  assert.deepEqual([keeper.state, keeper.details, keeper.signature, keeper.legacy, keeper.recoveryKey], ['none', {}, null, false, null]);
  assert.deepEqual(await store.list(), []);
});

test('a browser that keeps nothing: details last for the page, and nothing is said to be kept', async () => {
  const refusing = { get: async () => { throw new Error('refused'); }, put: async () => { throw new Error('refused'); }, list: async () => [], clear: async () => { throw new Error('refused'); } };
  const { keeper } = setUp({ store: refusing });
  await keeper.start();
  assert.equal(keeper.state, 'unavailable');
  assert.equal(await keeper.save({ details: DETAILS }), 'unavailable');
  assert.deepEqual(keeper.details, DETAILS);
  await keeper.forget();
  assert.deepEqual([keeper.state, keeper.details], ['unavailable', {}]);
});

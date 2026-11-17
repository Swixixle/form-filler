// Walks Form Filler in Chromium at phone size with the invented forms in tests/fixtures: a crooked phone photo of a
// form, the same form as a PDF, and a PDF with its own fill-in fields. Fills each, edits on the page, adds a blank,
// remembers a form, fills your details and today's date, signs, makes copies from a CSV, saves and reopens a template,
// prefills from a link, works offline, and (with --handwriting) reads the synthetic handwritten page. Every PDF is
// checked with pdftotext and pdf-lib.
//   node scripts/walk.cjs [dist] [--engine chromium|webkit] [--browser-path FILE] [--shots DIR] [--handwriting]
// --engine webkit walks the same steps in WebKit, the engine of Safari, of an iPhone and of the Mac app's window.
// --browser-path walks in another build of the engine (an older one, say) instead of the one Playwright installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const playwright = require('playwright');

const folder = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'dist');
const shots = process.argv.includes('--shots') ? path.resolve(process.argv[process.argv.indexOf('--shots') + 1]) : null;
const handwriting = process.argv.includes('--handwriting');
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const engine = option('--engine') || 'chromium', browserPath = option('--browser-path');
if (!playwright[engine]?.launch) { console.error('Unknown --engine "' + engine + '": use chromium or webkit.'); process.exit(2); }
const fixtures = path.resolve(__dirname, '../tests/fixtures');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'form-filler-walk-'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const ANSWERS = 'Jane Roe. 11/13/2026. Respiratory Care\nVentilator. VNT-2219. 1\nOximeter. OX-77. 2\n-. x\nReturn by Friday. J. R. Smith';
const HF = /^https:\/\/([a-z0-9-]+\.)*(huggingface\.co|hf\.co)\//;
const results = [];
const step = async (name, work) => { try { await work(); results.push([true, name]); console.log('PASS  ' + name); } catch (error) { results.push([false, name]); console.log('FAIL  ' + name + '\n        ' + String(error.message).split('\n').slice(0, 8).join('\n        ')); } };
// pdftotext's text; a complaint from poppler about the file fails the step.
const pdfText = file => { const run = spawnSync('pdftotext', ['-layout', file, '-']); assert.equal(run.stderr.toString(), '', 'poppler reads ' + path.basename(file) + ' without complaint'); return run.stdout.toString(); };
const today = (() => { const date = new Date(); return String(date.getMonth() + 1).padStart(2, '0') + '/' + String(date.getDate()).padStart(2, '0') + '/' + date.getFullYear(); })();

(async () => {
  const { PDFDocument } = await import('pdf-lib');
  const lib = await import(path.resolve(__dirname, '../src/lib/index.js'));
  const server = http.createServer((request, response) => {
    const file = path.join(folder, decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    if (!file.startsWith(folder) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, origin = 'http://127.0.0.1:' + port + '/', sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  // The server gone, as when there is no connection (nothing can be fetched from it), and back again.
  const serverDown = () => new Promise(resolve => { server.close(resolve); for (const socket of sockets) socket.destroy(); });
  const serverUp = () => new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const browser = await playwright[engine].launch(browserPath ? { executablePath: browserPath } : {});
  console.log('Walking in ' + engine + ' ' + browser.version() + (browserPath ? ' (' + browserPath + ')' : '') + '.');
  const outside = [], problems = [];
  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true });
    context.on('request', request => { const url = request.url(); if (!url.startsWith(origin) && !/^(data|blob):/.test(url)) outside.push(url); });
    const page = await context.newPage();
    page.on('pageerror', error => problems.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !/^(Estimating resolution|Detected \d+ diacritics)/.test(message.text())) problems.push(message.text()); });
    return { context, page };
  };
  let { context, page } = await open();
  const shot = async name => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: false }); } };
  const values = () => page.$$eval('[data-blank]', inputs => inputs.map(input => input.type === 'checkbox' ? input.checked : input.value));
  const save = async (button, name) => { const [download] = await Promise.all([page.waitForEvent('download'), page.click(button)]); const file = path.join(scratch, name); await download.saveAs(file); return file; };
  const fieldsOf = async file => { const doc = await PDFDocument.load(fs.readFileSync(file)); return doc.getForm().getFields().map(field => [field.getName(), field.constructor.name === 'PDFCheckBox' ? field.isChecked() : field.constructor.name === 'PDFDropdown' ? field.getSelected()[0] : field.constructor.name === 'PDFRadioGroup' ? field.getSelected() : field.getText() ?? '']); };
  const summary = () => page.locator('.panel .subtle').first().innerText();
  const openForm = async (name, done) => { await page.setInputFiles('#form-file', path.join(fixtures, name)); await page.waitForFunction(text => !document.querySelector('.busy') && (document.querySelector('.panel .subtle')?.textContent || '').includes(text), done, { timeout: 120000 }); };
  const typeAnswers = async text => { await page.fill('#answers', text); await page.waitForTimeout(100); };
  const expected = ['Jane Roe', '11/13/2026', 'Respiratory Care', 'Ventilator', 'VNT-2219', '1', 'Oximeter', 'OX-77', '2', false, true, 'Return by Friday', 'J. R. Smith'];

  await page.goto(origin);
  await step('the page is installable: a manifest with icons, and a service worker that keeps its files', async () => {
    const manifest = await (await page.request.get(origin + 'manifest.webmanifest')).json();
    assert.equal(manifest.display, 'standalone'); assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
    await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready.then(() => true), null, { timeout: 30000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    const kept = await page.evaluate(async () => { const keys = await caches.keys(); const cache = await caches.open(keys.find(key => key.startsWith('form-filler-'))); return (await cache.keys()).length; });
    assert.ok(kept >= 15, kept + ' files kept');
    const version = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')).version;
    assert.match(await page.locator('footer.version').innerText(), new RegExp('^Form Filler ' + version.replace(/\./g, '\\.') + '( · [0-9a-f]{7})?$'), 'the page says which version it is');
  });
  await step('a crooked phone photo of a form: straightened, and its 13 blanks found', async () => {
    await openForm('form-photo.png', 'blanks found');
    assert.match(await summary(), /13 blanks found · straightened 1\.2°/);
  });
  await step('loose answers land in order: periods and lines move on, a dash skips, x ticks', async () => {
    await page.uncheck('#use-details');
    await typeAnswers(ANSWERS);
    assert.deepEqual(await values(), expected);
    assert.match(await page.locator('.list').innerText(), /Name\s+Jane Roe/);
    await shot('form-1-filled');
  });
  await step('an answer changed on the form itself stays changed', async () => {
    await page.locator('[data-blank]').nth(2).fill('Respiratory Therapy'); await page.waitForTimeout(50);
    await typeAnswers(ANSWERS + '\n');
    assert.equal((await values())[2], 'Respiratory Therapy');
  });
  await step('the editable PDF holds a field per blank with its answer; the print-ready one has the answers as text', async () => {
    const fields = await fieldsOf(await save('#pdf-edit', 'filled.pdf'));
    assert.equal(fields.length, 13);
    assert.deepEqual(fields.map(([, value]) => value), [...expected.slice(0, 2), 'Respiratory Therapy', ...expected.slice(3)]);
    const printable = await save('#pdf-print', 'print.pdf'), text = pdfText(printable);
    for (const word of ['Jane Roe', 'VNT-2219', 'Return by Friday', 'J. R. Smith']) assert.ok(text.includes(word), word + ' in the print-ready PDF');
    assert.equal((await fieldsOf(printable)).length, 0, 'nothing left to edit');
    assert.match(await page.locator('.prints').innerText(), /Editable PDF\s+[0-9a-f]{64}[\s\S]*Print-ready PDF\s+[0-9a-f]{64}/);
  });
  await step('a blank the finder missed can be added by dragging across it, and removed', async () => {
    await page.click('#add-mode');
    const box = await page.locator('.sheet').boundingBox();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.71); await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.74, { steps: 4 }); await page.mouse.up();
    assert.equal(await page.locator('[data-blank]').count(), 14);
    await page.locator('.remove').last().click();
    assert.equal(await page.locator('[data-blank]').count(), 13);
    await page.click('#add-mode');
  });
  await step('the same form as a PDF: its own page is kept, and the same 13 blanks are found', async () => {
    await openForm('form.pdf', 'form.pdf');
    assert.match(await summary(), /13 blanks found/);
    await typeAnswers(ANSWERS);
    assert.deepEqual(await values(), expected);
    const editable = await save('#pdf-edit', 'filled-from-pdf.pdf');
    assert.match(pdfText(editable), /Equipment Loan Request \(invented form\)/, 'the original page text is still text: the page was copied, not photographed');
    assert.equal((await fieldsOf(editable)).length, 13);
    await shot('form-2-pdf');
  });
  await step('a form seen before is remembered by its fingerprint: its blanks come back at once, with no reading', async () => {
    const started = Date.now();
    await openForm('form-photo.png', 'remembered from last time');
    assert.match(await summary(), /13 blanks remembered from last time/);
    assert.ok(Date.now() - started < 8000, 'took ' + (Date.now() - started) + ' ms');
    assert.equal(await page.locator('#refind').count(), 1);
  });
  await step('your details and today\'s date fill their blanks, and typed answers pass over them', async () => {
    await page.locator('#details-panel summary').click();
    await page.fill('[name=detail-fullName]', 'Jane Roe'); await page.click('#save-details');
    await page.check('#use-details');
    await typeAnswers('Respiratory Care\nVentilator');
    const now = await values();
    assert.deepEqual(now.slice(0, 4), ['Jane Roe', today, 'Respiratory Care', 'Ventilator']);
    assert.match(await page.locator('.list').innerText(), /Jane Roe\s+filled for you/);
    assert.match(await page.locator('.toggle').first().innerText(), /\(2 blanks\)/);
    await typeAnswers('2) 12/01/2026. Respiratory Care');
    assert.deepEqual((await values()).slice(1, 3), ['12/01/2026', 'Respiratory Care'], 'a numbered answer still goes where it says');
    await shot('form-3-details');
  });
  await step('signing: drawn with a finger in the pad, placed as a picture in the Signature blank', async () => {
    await typeAnswers('Respiratory Care');
    await page.locator('[data-sign]').first().click();
    const pad = await page.locator('dialog.pad canvas').boundingBox();
    await page.mouse.move(pad.x + pad.width * 0.1, pad.y + pad.height * 0.6); await page.mouse.down();
    for (const [x, y] of [[0.2, 0.3], [0.3, 0.7], [0.45, 0.25], [0.6, 0.7], [0.8, 0.4]]) await page.mouse.move(pad.x + pad.width * x, pad.y + pad.height * y, { steps: 6 });
    await page.mouse.up();
    await shot('form-4-sign');
    await page.click('dialog.pad button[value=use]');
    await page.waitForSelector('.blank img.signed');
    const editable = await save('#pdf-edit', 'signed.pdf'), bytes = fs.readFileSync(editable).toString('latin1');
    assert.equal((await fieldsOf(editable)).length, 12, 'the signature is a picture, not one of the fields');
    assert.equal((bytes.match(/\/Subtype \/Image/g) || []).length, 3, 'the page picture, the signature and its see-through mask');
    assert.match(bytes, /\/SMask/);
    await page.click('.blank .unsign');
    assert.equal(await page.locator('.blank img.signed').count(), 0);
  });
  await step('a PDF with its own fields: those are the blanks, plus the drawn signature line; the same fields are filled', async () => {
    await openForm('fillable.pdf', 'fillable.pdf');
    assert.match(await summary(), /9 blanks found · 8 are the PDF’s own fields/);
    assert.equal(await page.locator('select[data-blank]').count(), 1, 'the drop-down is a choice box');
    assert.deepEqual(await page.$$eval('input[type=radio][data-blank]', buttons => buttons.map(button => button.value)), ['Day', 'Night'], 'the radio group is a button over each of its own buttons');
    await typeAnswers('jane@example.org. 555-0100. emer. night. x. Visiting the unit for training');
    const editable = await save('#pdf-edit', 'fillable-filled.pdf'), fields = Object.fromEntries(await fieldsOf(editable));
    assert.deepEqual(Object.keys(fields).sort(), ['blank-9', 'email', 'escort', 'full_name', 'phone', 'reason', 'shift', 'unit', 'visit_date'], 'its own 8 fields, one added for the signature line');
    assert.equal(fields.full_name, 'Jane Roe'); assert.equal(fields.visit_date, today); assert.equal(fields.email, 'jane@example.org');
    assert.equal(await page.locator('select[data-blank]').first().inputValue(), 'Emergency', 'the page shows the choice "emer" picks');
    assert.equal(await page.locator('input[type=radio][value=Night]').isChecked(), true, 'the page shows the button "night" picks');
    assert.equal(fields.unit, 'Emergency'); assert.equal(fields.shift, 'Night'); assert.equal(fields.escort, true); assert.equal(fields.reason, 'Visiting the unit for training');
    const printable = await save('#pdf-print', 'fillable-print.pdf'), text = pdfText(printable);
    assert.equal((await fieldsOf(printable)).length, 0);
    for (const word of ['Jane Roe', 'jane@example.org', 'Emergency', 'Visiting the unit']) assert.ok(text.includes(word), word + ' in the print-ready PDF');
    await shot('form-5-fillable');
  });
  await step('a radio button tapped on the page is the answer', async () => {
    await page.locator('input[type=radio][value=Day]').check();
    const fields = Object.fromEntries(await fieldsOf(await save('#pdf-edit', 'fillable-day.pdf')));
    assert.equal(fields.shift, 'Day');
  });
  await step('what a PDF field cannot take is said, not dropped: a choice it does not offer', async () => {
    await typeAnswers('jane@example.org. 555-0100. Pharmacy');
    await save('#pdf-edit', 'fillable-wrong.pdf');
    assert.match(await page.locator('.note').innerText(), /"Pharmacy" is not one of its choices \(ICU, Emergency, Floor\)/);
  });
  await step('many copies from a CSV: columns matched by number, the unknown one named, one PDF with a copy per row', async () => {
    await openForm('form.pdf', 'form.pdf');
    await page.uncheck('#use-details'); await typeAnswers('');
    await page.locator('#merge-panel summary').click();
    const columns = await save('#csv-blank', 'columns.csv');
    assert.equal(lib.parseCsv(fs.readFileSync(columns, 'utf8'))[0].length, 13);
    const csv = path.join(scratch, 'rows.csv');
    fs.writeFileSync(csv, '1,#4,blank 5,Color\r\nAlex Doe,Ventilator,VNT-1001,blue\r\n"Roe, Jane",Oximeter,OX-2002,\r\nSam Poe,Nebulizer,NB-3003,red\r\n');
    await page.setInputFiles('#csv-file', csv);
    await page.waitForSelector('#merge-go');
    const listing = await page.locator('.columns').innerText();
    assert.match(listing, /Color → matches no blank/); assert.match(listing, /#4 → blank 4/);
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#merge-go')]);
    const merged = path.join(scratch, 'merged.pdf'); await download.saveAs(merged);
    assert.equal((await PDFDocument.load(fs.readFileSync(merged))).getPageCount(), 3);
    const text = pdfText(merged);
    for (const word of ['Alex Doe', 'Roe, Jane', 'Sam Poe', 'VNT-1001', 'OX-2002', 'NB-3003']) assert.ok(text.includes(word), word + ' in the merged PDF');
    assert.equal((await fieldsOf(merged)).length, 0, 'merged copies are print-ready');
    await shot('form-6-merge');
  });
  await step('a PDF longer than the 10 pages shown: every page is in the filled copy, in order, and the page says so', async () => {
    const long = await PDFDocument.create();
    for (let sheet = 1; sheet <= 12; sheet++) {
      const sheetPage = long.addPage([612, 792]);
      sheetPage.drawText('Sheet ' + sheet + ' of the invented form', { x: 72, y: 720, size: 12 }); sheetPage.drawText('Name:', { x: 72, y: 652, size: 11 });
      sheetPage.drawLine({ start: { x: 112, y: 650 }, end: { x: 380, y: 650 }, thickness: 1 });
    }
    const file = path.join(scratch, 'long.pdf'); fs.writeFileSync(file, await long.save());
    await page.setInputFiles('#form-file', file);
    await page.waitForFunction(() => !document.querySelector('.busy') && (document.querySelector('.panel .subtle')?.textContent || '').includes('long.pdf'), null, { timeout: 300000 });
    assert.match(await summary(), /10 pages · 10 blanks found/);
    assert.match(await page.locator('.note').first().innerText(), /Only the first 10 pages are shown; the other 2 are kept as they are\./);
    await typeAnswers('Jane Roe');
    for (const [button, name] of [['#pdf-edit', 'long-filled.pdf'], ['#pdf-print', 'long-print.pdf']]) {
      const made = await save(button, name), sheets = pdfText(made).split('\f').filter(text => text.trim());
      assert.equal((await PDFDocument.load(fs.readFileSync(made))).getPageCount(), 12, name + ' has all 12 pages');
      sheets.forEach((text, index) => assert.ok(text.includes('Sheet ' + (index + 1) + ' of'), name + ': page ' + (index + 1) + ' is sheet ' + (index + 1)));
    }
    assert.ok(pdfText(path.join(scratch, 'long-print.pdf')).split('\f')[0].includes('Jane Roe'), 'the answer is on page 1');
  });
  let templateFile;
  await step('a template file: the photo form\'s blanks and its page picture, in plain JSON another program can read', async () => {
    await openForm('form-photo.png', 'remembered from last time');
    templateFile = await save('#template-save', 'template.json');
    const template = lib.readTemplate(fs.readFileSync(templateFile, 'utf8'));
    assert.equal(template.blanks.length, 13); assert.equal(template.form.type, 'image');
    assert.match(template.pages[0].image, /^data:image\/jpeg;base64,/);
  });
  await step('offline: with no connection the page opens again and still finds a new form\'s blanks', async () => {
    // The server is taken away, so nothing can be fetched; the page has to come from what it kept. (The browser's
    // own "offline" switch is not used: in WebKit under Playwright it stops the kept page from loading too.)
    await serverDown();
    try {
      await page.reload();
      await page.waitForSelector('#form-file', { state: 'attached' });
      assert.equal(await page.evaluate(() => fetch('./manifest.webmanifest?fresh=' + Date.now(), { cache: 'no-store' }).then(response => response.headers.get('content-type'))), 'application/manifest+json', 'the kept copy answers');
      assert.equal(await new Promise(resolve => http.get(origin, () => resolve('answered')).on('error', () => resolve('no connection'))), 'no connection', 'and the server really is gone');
      await openForm('form.png', 'blanks found');
      assert.match(await summary(), /13 blanks found/);
    } finally { await serverUp(); }
  });
  await context.close();
  ({ context, page } = await open());
  await step('on a new device, the template file alone opens the form, its blanks in place, ready to fill', async () => {
    await page.goto(origin);
    await page.setInputFiles('#template-file', templateFile);
    await page.waitForFunction(() => /remembered from last time/.test(document.querySelector('.panel .subtle')?.textContent || ''), null, { timeout: 30000 });
    await page.uncheck('#use-details'); await typeAnswers(ANSWERS);
    assert.deepEqual(await values(), expected);
    assert.equal((await fieldsOf(await save('#pdf-edit', 'from-template.pdf'))).length, 13);
  });
  await step('a template the command line made from a PDF\'s own fields (in points) lands on the page drawn in pixels', async () => {
    const made = path.join(scratch, 'fields.json');
    const run = spawnSync(process.execPath, [path.resolve(__dirname, '../bin/form-filler.mjs'), 'fields', path.join(fixtures, 'fillable.pdf'), '--out', made], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    await openForm('fillable.pdf', 'fillable.pdf');
    await page.setInputFiles('#template-file', made);
    await page.waitForFunction(() => /8 blanks remembered/.test(document.querySelector('.panel .subtle')?.textContent || ''), null, { timeout: 30000 });
    const sheet = await page.locator('.sheet').boundingBox(), first = await page.locator('[data-blank]').first().boundingBox();
    // Full name's field: x = 160 pt of 612, top at 792 - 698 pt of 792.
    assert.ok(Math.abs((first.x - sheet.x) / sheet.width - 160 / 612) < 0.01 && Math.abs((first.y - sheet.y) / sheet.height - 94 / 792) < 0.01, JSON.stringify([sheet, first]));
  });
  await step('another program can hand over answers in the link: #answers=…', async () => {
    await page.goto(origin + '#answers=' + encodeURIComponent('Jane Roe. 11/13/2026. Nursing'));
    await page.reload();
    await openForm('form.png', 'blanks found');
    await page.uncheck('#use-details');
    assert.deepEqual((await values()).slice(0, 3), ['Jane Roe', '11/13/2026', 'Nursing']);
  });
  if (handwriting) await step('handwriting (synthetic: handwriting-style fonts): five lines cut, read on the device, shown beside their pictures', async () => {
    await page.selectOption('#hand-model', 'small');
    await page.setInputFiles('#hand-photo', path.join(fixtures, 'handwritten.png'));
    await page.waitForFunction(() => !document.querySelector('.busy') && document.querySelectorAll('[data-hand]').length && [...document.querySelectorAll('[data-hand]')].every(input => !input.placeholder), null, { timeout: 300000 });
    const read = await page.$$eval('[data-hand]', inputs => inputs.map(input => input.value));
    const written = ['Jane Roe', '11/13/2026', 'Respiratory Care', 'Ventilator VNT 2219', 'Return by Friday'];
    assert.equal(read.length, 5, JSON.stringify(read));
    const exact = read.filter((text, index) => text === written[index]).length;
    console.log('        read: ' + JSON.stringify(read));
    assert.ok(exact >= 3, exact + ' of 5 lines read exactly');
    assert.equal(await page.locator('.hand img').count(), 5);
    await page.locator('.hand').scrollIntoViewIfNeeded(); await shot('form-7-handwriting');
    await page.locator('[data-hand]').nth(3).fill('Ventilator VNT 2219');
    await page.click('#hand-use');
    assert.match(await page.inputValue('#answers'), /Ventilator VNT 2219\nReturn by Friday$/);
  });
  if (handwriting) await step('paper answers with blank numbers in front (synthetic): each read line goes to its numbered blank; an unreadable number is set aside and named', async () => {
    await page.uncheck('#use-details'); await typeAnswers('');
    await page.setInputFiles('#hand-photo', path.join(fixtures, 'handwritten-numbered.png'));
    await page.waitForFunction(() => !document.querySelector('.busy') && document.querySelectorAll('[data-hand]').length && [...document.querySelectorAll('[data-hand]')].every(input => !input.placeholder), null, { timeout: 300000 });
    console.log('        read: ' + JSON.stringify(await page.$$eval('[data-hand]', inputs => inputs.map(input => input.value))));
    await page.click('#hand-use');
    const now = await values();
    assert.equal(now[2], 'Jane Roe'); assert.equal(now[6], 'Respiratory Care'); assert.equal(now[1], 'Ventilator');
    console.log('        note: ' + await page.locator('.note').first().innerText());
    await page.locator('.sheet').first().scrollIntoViewIfNeeded(); await shot('form-9-numbered-paper');
  });
  await step('in a browser without the newest JavaScript (no Map.getOrInsertComputed, as in Chromium 143) a PDF still opens', async () => {
    // What such a browser lacks is taken away here, once, before anything else runs: in the page by a script that
    // runs first, and in the PDF reader's worker (which that script does not reach) by putting the same line at the
    // top of the worker's own file.
    const strip = 'for (const kind of [Map, WeakMap]) for (const name of ["getOrInsertComputed", "getOrInsert"]) delete kind.prototype[name]; delete Math.sumPrecise;\n';
    const old = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    try {
      await old.addInitScript(strip);
      await old.route(url => /pdf\.worker[^/]*\.mjs$/.test(url.pathname), async route => { const response = await route.fetch(); await route.fulfill({ response, body: strip + await response.text() }); });
      const other = await old.newPage();
      await other.goto(origin);
      assert.equal(await other.evaluate(() => typeof Map.prototype.getOrInsertComputed), 'undefined', 'the feature really is missing here');
      await other.setInputFiles('#form-file', path.join(fixtures, 'fillable.pdf'));
      await other.waitForFunction(() => !document.querySelector('.busy') && (document.querySelector('.sheet') || document.querySelector('.note')), null, { timeout: 120000 });
      assert.deepEqual(await other.locator('.note').allInnerTexts(), [], 'the page reports no error');
      assert.match(await other.locator('.panel .subtle').first().innerText(), /9 blanks found · 8 are the PDF’s own fields/);
    } finally { await old.close(); }
  });
  await step('on a computer: a form dropped on the page opens, the answers box is ready to type in, and it sits beside the form', async () => {
    await context.close();
    context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    context.on('request', request => { const url = request.url(); if (!url.startsWith(origin) && !/^(data|blob):/.test(url)) outside.push(url); });
    page = await context.newPage();
    page.on('pageerror', error => problems.push(error.message));
    await page.goto(origin);
    assert.ok(await page.locator('.desk').isVisible(), 'the page says a form can be dropped or pasted');
    const bytes = [...fs.readFileSync(path.join(fixtures, 'fillable.pdf'))];
    await page.evaluate(bytes => {
      const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'fillable.pdf', { type: 'application/pdf' }));
      document.body.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    }, bytes);
    await page.waitForFunction(() => !document.querySelector('.busy') && (document.querySelector('.panel .subtle')?.textContent || '').includes('fillable.pdf') && document.querySelector('.sheet'), null, { timeout: 120000 });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'answers', 'the answers box has the cursor');
    assert.equal(await page.evaluate(() => document.body.classList.contains('dropping')), false);
    const answersBox = await page.locator('.answers-panel').boundingBox(), sheet = await page.locator('.sheet').first().boundingBox();
    assert.ok(answersBox.x + answersBox.width <= sheet.x && Math.abs(answersBox.y - sheet.y) < 200, 'side by side: ' + JSON.stringify([answersBox, sheet]));
    await shot('form-8-computer');
  });
  await step('on a computer: ⌘S / Ctrl+S downloads the editable PDF', async () => {
    await page.keyboard.type('Jane Roe. jane@example.org. 555-0100');
    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('ControlOrMeta+s')]);
    const file = path.join(scratch, 'keyed.pdf'); await download.saveAs(file);
    assert.equal(Object.fromEntries(await fieldsOf(file)).email, 'jane@example.org');
  });
  await step('on a computer: a pasted screenshot of a form opens as the form', async () => {
    const bytes = [...fs.readFileSync(path.join(fixtures, 'form.png'))];
    await page.locator('.top h1').click();
    await page.evaluate(bytes => {
      const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, bytes);
    await page.waitForFunction(() => !document.querySelector('.busy') && (document.querySelector('.panel .subtle')?.textContent || '').includes('pasted form.png'), null, { timeout: 120000 });
    assert.match(await summary(), /13 blanks/);
  });
  await step('nothing was sent anywhere' + (handwriting ? ' (only the handwriting model fetched from Hugging Face; no code CDN)' : ''), async () => {
    assert.deepEqual(outside.filter(url => !(handwriting && HF.test(url))), []);
  });
  await step('no page or console errors', async () => assert.deepEqual(problems, []));
  await browser.close(); server.close();
  const failed = results.filter(([ok]) => !ok).length;
  console.log(failed ? failed + ' of ' + results.length + ' steps failed.' : 'All ' + results.length + ' steps pass.');
  process.exit(failed ? 1 : 0);
})();

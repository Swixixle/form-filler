// Walks Form Filler in Chromium at phone size with the invented forms in tests/fixtures: a crooked phone photo of a
// form and the same form as a PDF. Fills each from loose answers, edits one on the page, adds a blank by hand,
// downloads both PDFs and checks what is in them with pdftotext and pdf-lib.
//   node scripts/walk.cjs [dist] [--shots DIR]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const folder = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'dist');
const shots = process.argv.includes('--shots') ? path.resolve(process.argv[process.argv.indexOf('--shots') + 1]) : null;
const fixtures = path.resolve(__dirname, '../tests/fixtures');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.gz': 'application/gzip' };
const ANSWERS = 'Jane Roe. 11/13/2026. Respiratory Care\nVentilator. VNT-2219. 1\nOximeter. OX-77. 2\n-. x\nReturn by Friday. J. R. Smith';
const results = [];
const step = async (name, work) => { try { await work(); results.push([true, name]); console.log('PASS  ' + name); } catch (error) { results.push([false, name]); console.log('FAIL  ' + name + '\n        ' + String(error.message).split('\n').slice(0, 6).join('\n        ')); } };

(async () => {
  const server = http.createServer((request, response) => {
    const file = path.join(folder, decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    if (!file.startsWith(folder) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true });
  const outside = [];
  context.on('request', request => { const url = request.url(); if (!url.startsWith(origin) && !/^(data|blob):/.test(url)) outside.push(url); });
  const page = await context.newPage(), problems = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/^(Estimating resolution|Detected \d+ diacritics)/.test(message.text())) problems.push(message.text()); });
  const shot = async name => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: false }); } };
  const values = () => page.$$eval('[data-blank]', inputs => inputs.map(input => input.type === 'checkbox' ? input.checked : input.value));
  const save = async (button, name) => { const [download] = await Promise.all([page.waitForEvent('download'), page.click(button)]); const file = path.join(require('node:os').tmpdir(), name); await download.saveAs(file); return file; };
  const fieldsOf = async file => { const { PDFDocument } = await import('pdf-lib'); const doc = await PDFDocument.load(fs.readFileSync(file)); return doc.getForm().getFields().map(field => [field.getName(), field.constructor.name === 'PDFCheckBox' ? field.isChecked() : field.getText() ?? '']); };
  const expected = ['Jane Roe', '11/13/2026', 'Respiratory Care', 'Ventilator', 'VNT-2219', '1', 'Oximeter', 'OX-77', '2', false, true, 'Return by Friday', 'J. R. Smith'];

  await page.goto(origin);
  await step('a crooked phone photo of a form: straightened, and its 13 blanks found', async () => {
    await page.setInputFiles('#form-file', path.join(fixtures, 'form-photo.png'));
    await page.waitForFunction(() => !document.querySelector('.busy') && /blanks? found/.test(document.querySelector('.panel .subtle')?.textContent || ''), null, { timeout: 120000 });
    const summary = await page.locator('.panel .subtle').first().innerText();
    assert.match(summary, /13 blanks found · straightened 1\.2°/);
  });
  await step('loose answers land in order: periods and lines move on, a dash skips, x ticks', async () => {
    await page.fill('#answers', ANSWERS); await page.waitForTimeout(100);
    assert.deepEqual(await values(), expected);
    assert.match(await page.locator('.list').innerText(), /Name\s+Jane Roe/);
    await shot('form-1-filled');
  });
  await step('an answer changed on the form itself stays changed', async () => {
    await page.locator('[data-blank]').nth(2).fill('Respiratory Therapy'); await page.waitForTimeout(50);
    await page.fill('#answers', ANSWERS + '\n'); await page.waitForTimeout(50);
    assert.equal((await values())[2], 'Respiratory Therapy');
  });
  await step('the editable PDF holds a field per blank with its answer; the print-ready one has the answers as text', async () => {
    const editable = await save('#pdf-edit', 'filled.pdf');
    const fields = await fieldsOf(editable);
    assert.equal(fields.length, 13);
    assert.deepEqual(fields.map(([, value]) => value), [...expected.slice(0, 2), 'Respiratory Therapy', ...expected.slice(3)]);
    const printable = await save('#pdf-print', 'print.pdf');
    const text = execFileSync('pdftotext', ['-layout', printable, '-']).toString();
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
    await page.setInputFiles('#form-file', path.join(fixtures, 'form.pdf'));
    await page.waitForFunction(() => !document.querySelector('.busy') && /form\.pdf/.test(document.querySelector('.panel .subtle')?.textContent || ''), null, { timeout: 120000 });
    assert.match(await page.locator('.panel .subtle').first().innerText(), /13 blanks found/);
    await page.fill('#answers', ANSWERS); await page.waitForTimeout(100);
    assert.deepEqual(await values(), expected);
    const editable = await save('#pdf-edit', 'filled-from-pdf.pdf');
    const text = execFileSync('pdftotext', [editable, '-']).toString();
    assert.match(text, /Equipment Loan Request \(invented form\)/, 'the original page text is still text: the page was copied, not photographed');
    assert.equal((await fieldsOf(editable)).length, 13);
    await shot('form-2-pdf');
  });
  await step('nothing was sent anywhere', async () => assert.deepEqual(outside, []));
  await step('no page or console errors', async () => assert.deepEqual(problems, []));
  await browser.close(); server.close();
  const failed = results.filter(([ok]) => !ok).length;
  console.log(failed ? failed + ' of ' + results.length + ' steps failed.' : 'All ' + results.length + ' steps pass.');
  process.exit(failed ? 1 : 0);
})();

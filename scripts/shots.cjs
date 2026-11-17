// Takes the README's pictures (docs/images) from the built page, with the invented forms in tests/fixtures and
// invented answers. Nothing real is in them. Needs a build (npm run build) and Playwright's browsers.
//   node scripts/shots.cjs [dist] [--before DIR]
// --before DIR: a build of the page as it was before the WebKit fix (version 2.1.0). With it, webkit-qty.png is made:
// the same table in WebKit before and after. Without it that picture is left as it is.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, webkit } = require('playwright');

const args = process.argv.slice(2), option = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const folder = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : 'dist'), before = option('--before') && path.resolve(option('--before'));
const fixtures = path.resolve(__dirname, '../tests/fixtures'), out = path.resolve(__dirname, '../docs/images');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const ANSWERS = 'Jane Roe\nFacilities\nProjector. PJ-2219. 1\nExtension cord. EC-77. 2\n-. x\nReturn by Friday';
const serve = root => new Promise(resolve => {
  const server = http.createServer((request, response) => {
    const file = path.join(root, decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, origin: 'http://127.0.0.1:' + server.address().port + '/' }));
});
const openForm = async (page, name) => { await page.setInputFiles('#form-file', path.join(fixtures, name)); await page.waitForFunction(text => !document.querySelector('.busy') && (document.querySelector('.panel .subtle')?.textContent || '').includes(text) && document.querySelector('.sheet'), name, { timeout: 120000 }); };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const now = await serve(folder), browser = await chromium.launch();
  // A phone: the form as photographed (crooked, shaded), its blanks found; the answers; the filled form, signed.
  const phone = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block' }), page = await phone.newPage();
  await page.goto(now.origin);
  await openForm(page, 'form-photo.png');
  await page.locator('.sheet').screenshot({ path: path.join(out, 'blanks.png') });
  await page.fill('#answers', ANSWERS); await page.waitForTimeout(200);
  await page.locator('.answers-panel').screenshot({ path: path.join(out, 'answers.png') });
  await page.locator('[data-sign]').first().click();
  const pad = await page.locator('dialog.pad canvas').boundingBox();
  await page.mouse.move(pad.x + pad.width * 0.12, pad.y + pad.height * 0.62); await page.mouse.down();
  for (const [x, y] of [[0.2, 0.3], [0.28, 0.7], [0.4, 0.28], [0.52, 0.7], [0.66, 0.4], [0.86, 0.5]]) await page.mouse.move(pad.x + pad.width * x, pad.y + pad.height * y, { steps: 8 });
  await page.mouse.up();
  await page.click('dialog.pad button[value=use]'); await page.waitForSelector('.blank img.signed');
  await page.locator('.sheet').screenshot({ path: path.join(out, 'filled.png') });
  await phone.close();

  // The same table of the same invented PDF in WebKit, as the page numbered its blanks before the fix and now.
  if (before) {
    const old = await serve(before), safari = await webkit.launch(), strips = [];
    for (const origin of [old.origin, now.origin]) {
      const context = await safari.newContext({ viewport: { width: 1000, height: 1300 }, deviceScaleFactor: 2, serviceWorkers: 'block' }), tab = await context.newPage();
      await tab.goto(origin); await openForm(tab, 'form.pdf');
      const sheet = await tab.locator('.sheet').boundingBox();
      strips.push({ blanks: await tab.locator('.sheet .blank').count(), picture: (await tab.screenshot({ clip: { x: sheet.x, y: sheet.y + sheet.height * 0.215, width: sheet.width, height: sheet.height * 0.12 } })).toString('base64') });
      await context.close();
    }
    await safari.close(); old.server.close();
    const sheet = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 });
    const figure = (title, strip, words) => '<figure><figcaption><b>' + title + '</b> ' + words.replace('N', strip.blanks) + '</figcaption><img src="data:image/png;base64,' + strip.picture + '"></figure>';
    await sheet.setContent('<style>body{margin:0;font:15px/1.4 system-ui,sans-serif;color:#172c27;background:#fff}main{padding:14px 16px;width:920px}figure{margin:0 0 14px}figcaption{margin:0 0 6px}img{display:block;width:100%;border:1px solid #dce5dd;border-radius:6px}</style><main>' +
      figure('Before, in WebKit:', strips[0], 'the ring of the “Q” in “Qty” is taken for a checkbox and numbered 4, so the cells under it are 5 to 10 (N blanks on the page) and every later answer lands one blank late.') +
      figure('Now:', strips[1], 'a checkbox must have corners. The cells are 4 to 9 (N blanks), as in Chromium.') + '</main>');
    await sheet.locator('main').screenshot({ path: path.join(out, 'webkit-qty.png') });
    console.log('webkit-qty.png: ' + strips[0].blanks + ' blanks before, ' + strips[1].blanks + ' now');
  }
  await browser.close(); now.server.close();
  console.log('wrote ' + fs.readdirSync(out).join(', ') + ' in docs/images');
})().catch(error => { console.error('shots failed: ' + error.message); process.exit(1); });

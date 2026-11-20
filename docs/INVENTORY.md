# Inventory: what Form Filler is today

Phase 1 of the build plan ([BUILD_PLAN.md](BUILD_PLAN.md)). Written 2026-11-17 against `main` at `2747d0b` (version 2.1.0).
No feature code was changed to produce this.

**Since it was written:** in 2.4.1, defect 16 (a CSV's columns going stale), logged after 2.4.0, is fixed. In 2.4.0, defect 5 is fixed
where a table's header can be read the same twice; elsewhere its cells stay unlabelled. In 2.3.1, defect 11 is fixed but for a few cases it lists, and defects 12 to 15, found while
measuring that fix, are logged. In 2.3.0, defect 4 is fixed for checkboxes (table cells are still unlabelled). Before that,
on the same day (branches `phase-1-inventory` and `phase-2`): defects 1, 2 and 3 and
the unescaped signature in defect 8 are fixed, each with a test that failed before; defect 9's first half is fixed
(Playwright is declared); defect 10 is fixed (MIT licence). What changed and how it was checked is in
[PHASE2_PROPOSAL.md](PHASE2_PROPOSAL.md) under "Slice 0". The rest of this file still describes `main`.

**How to read it.** Every claim carries one of two marks:

- **[V]** verified in this session: the code was run, or the file was read and the claim is about what the file says.
- **[I]** inferred: reasoned from the code or from general knowledge, not run. Treat as likely, not certain.

## The short version

Form Filler 2.1.0 is a working, tested, browser-only form filler: a 750-line library, a 730-line page, a command-line
tool, 20 unit tests and a 24-step browser walk. It is small, honest about its limits, and nothing in it sends your data
anywhere. **[V]**

Against the build plan it is the *form reader* and *filler* boxes of the architecture, plus a head start on the phone
app. Everything else in the plan does not exist yet: no vault, no encryption, no archive, no ledger, no pre-flight, no
Crab, no desktop shell, no extension, no tax logic. **[V]**

Three things found by running it matter more than the rest:

1. **It is only tested in Chromium, and the plan's two main surfaces are both WebKit** (the Tauri shell on the Mac and
   Safari on an iPhone). In a WebKit build the blank finder invents a blank on both PDF test forms, which shifts every
   answer after it into the wrong blank. **[V]**
2. **PDFs do not open at all in a browser about a year old** (Chromium 143): pdf.js needs a JavaScript feature that
   new. Photos still work there. **[V]**
3. **A flat PDF longer than 10 pages loses its later pages on export**, while the page says they "are kept as they
   are". **[V]**

## How this was checked

| What | Result |
| --- | --- |
| Machine | A Mac (Apple Silicon). Node 24 for the build; the tests were also run on Node 20. **[V]** |
| `npm ci` | Installs cleanly. 674 MB of `node_modules`. `npm audit`: 4 high, all one chain (`picomatch` under `vite`), build-time only. **[V]** |
| `npm test` | **20 of 20 pass**, on Node 24.22.3 and on Node 20.20.0. **[V]** |
| `npm run build` | Builds `dist/` (32 MB) in about 1.3 s. **[V]** |
| `node scripts/walk.cjs dist`, CI's browser | Not run locally: the pinned Playwright 1.63.0 wants Chromium build 1243, which was not installed on the test machine at the time. GitHub's own run of it on this exact commit is green (Tests run 43981077611, 2026-11-16). **[V]** that it passed there. |
| The same walk, Chromium 143 (Playwright 1.57.0) | **16 of 24 pass.** All 8 failures are the steps that open a PDF. **[V]** |
| The same walk, WebKit 26.0 (Playwright's build, a stand-in for Safari and the Tauri webview) | **17 of 24 pass.** 2 root causes (below), 4 knock-on failures, 1 inconclusive. **[V]** |
| The live page, <https://swixixle.github.io/form-filler/> | Serves `2.1.0 · 2747d0b`. In Chrome 156 the invented fillable PDF opens with its 9 blanks and correct labels. **[V]** |
| `npm run check:handwriting` | Runs; reads 4 of the 5 synthetic lines right. Character error rate **4.3%** here, not the README's 1.4% (the date came back `111.1312026`). **[V]** |
| The command line, by hand | `fields`, `check`, `fill --print --strict` all work on the invented fillable PDF; the output PDF's Subject carries the form and answer fingerprints. **[V]** |

Not verified, and why:

- **A real phone, real Safari, a real Tauri webview.** Playwright's WebKit is a stand-in, not the same binary.
- **Any real form.** Every fixture is invented. No IRS form, no employer's form, no real handwriting was tried.
- **The Send button.** Headless Chromium has no share sheet, so the walk never presses it.
- **"Read a printed page"**, the **Print** button, and the **move-to-the-new-version** logic: no test covers them.
- **The handwriting reader in a browser** (`walk.cjs --handwriting`) and the Larger model: not run.
- **`scripts/make-fixtures.py` and `make-icons.py`**: they need Pillow and reportlab, which the test machine lacked,
  and `make-fixtures.py` hard-codes Linux font paths (`/usr/share/fonts/truetype/dejavu/…`), so it cannot run on a Mac as
  written. **[V]** by reading; not run.
- **Whether the offline step really fails in Safari.** It failed in Playwright's WebKit with "WebKit encountered an
  internal error" on reload, which may be the test tool, not the page.

## What exists

49 tracked files, about 2,770 lines of text outside the lock file and binaries. **[V]**

| Part | Files | Lines | What it is |
| --- | --- | --- | --- |
| Library | `src/lib/*.js` (10 files) | 750 | Everything that needs no browser. Its only runtime dependency is pdf-lib. |
| Page | `src/app/main.js`, `style.css`, `sw.js`, `handwriting-worker.js` | 727 | One vanilla-JS module that redraws the page from module-level state; no framework. |
| Command line | `bin/form-filler.mjs` | 106 | `fields`, `fill`, `check`. No browser, no network. |
| Tests | `tests/*.test.js` (3 files), 6 fixtures | 270 | `node:test`. All fixtures are invented. |
| Scripts | `scripts/` (6 files) | 532 | Asset copy, the browser walk, the handwriting check, fixture and icon drawing, a local server. |
| Delivery | `.github/workflows/ci.yml`, `pages.yml` | 64 | Tests on every push; every push to `main` publishes the page to GitHub Pages. |
| Docs | `README.md`, `CHANGELOG.md`, 5 screenshots | 203 | Accurate to the code as far as I checked. |

The library, module by module **[V]** (read in full):

| Module | Does |
| --- | --- |
| `blanks.js` | Finds blanks from a page's grayscale pixels: lines to write on, boxes and table cells, checkboxes. Adaptive threshold, deskew up to ±5°, reading order, and a label taken from the words to the left of or above a blank. Its own code, no OpenCV. |
| `fields.js` | Reads a PDF's own AcroForm fields (text, checkbox, radio, drop-down, list, signature) as blanks, with positions; merges them with pixel-found blanks. |
| `answers.js` | Splits loose answers into one per blank (period or new line moves on, `-` skips, `4)` jumps); numbered-lines mode for answers written on paper. |
| `output.js` | Builds the filled PDF with pdf-lib: editable (fields) or print-ready (flattened or drawn). Reports what would not fit instead of dropping it. Joins copies. |
| `templates.js` | A form's blanks as checked JSON, keyed by the form file's SHA-256. |
| `profile.js` | Ten personal details matched to blanks by label words; skips labels about someone else; fills today's date. |
| `merge.js` | CSV parser and column-to-blank matching for many copies. |
| `handwriting.js` | Cuts a photo of handwriting into lines. |
| `models.js` | Two TrOCR handwriting models, pinned to exact Hugging Face revisions. |

### Stack and dependencies

| | Version | Used for |
| --- | --- | --- |
| Node | `engines: >=22`; CI uses 22 | Tests, build, CLI. The tests also pass on Node 20. **[V]** |
| pdf-lib | 1.17.1 | The only runtime dependency of the library: reading fields, writing PDFs. |
| pdfjs-dist | 6.5.438 | Drawing PDF pages in the browser. |
| tesseract.js + English data | 7.0.0 / 1.0.0 | Reading printed text: blank labels, printed answer pages. |
| @huggingface/transformers | 4.3.2 | Running TrOCR (handwriting) in the browser on ONNX Runtime's WebAssembly. |
| vite | 7.3.7 | Build and dev server. |
| pngjs, two @fontsource fonts | 7.0.0 / 5.3.0 | Tests and synthetic fixtures. |
| Playwright | not declared | The walk needs it; CI installs 1.63.0 with `--no-save`. After a plain `npm ci`, `npm run walk` cannot run. **[V]** |
| poppler (`pdftotext`, `pdftoppm`) | system | Tests check output PDFs with it. **[V]** |
| Python + Pillow + reportlab | system | Redrawing fixtures and icons only. |
| Rust / Cargo | none | Not used yet. Needed for Tauri in phase 2. **[V]** |

Nothing is loaded from a code CDN at run time: Tesseract, its language data and the ONNX runtime are copied into the
build. The one outside request the page can make is the handwriting model, from Hugging Face, the first time
"Read handwriting" is used. The walk's "nothing was sent anywhere" step passes in both engines. **[V]**

## What works

Verified by a test, the walk, or by hand. "Chromium 143" and "WebKit 26" are this session's local runs; "CI" is
GitHub's run on the same commit.

| Feature | Verified how | Result |
| --- | --- | --- |
| Photo of a form: straightened, 13 blanks found in order | Unit tests; walk in Chromium 143 and WebKit 26 | Works **[V]** |
| Loose answers (periods, lines, `-`, `4)`, `x`) | Unit tests; walk in both engines | Works **[V]** |
| Change an answer on the form; add or remove a blank by dragging | Walk in both engines | Works **[V]** |
| Editable and print-ready PDF from a photographed form | Walk in both engines, checked with pdftotext and pdf-lib | Works **[V]** |
| A PDF's own fields read as blanks and filled in place (library, CLI) | Unit tests; CLI by hand | Works **[V]** |
| The same in the page | CI; live page in Chrome 156 | Works there **[V]**. Fails in Chromium 143, wrong in WebKit 26 (see below) |
| Form remembered by its fingerprint | Walk in both engines | Works **[V]** |
| Template file saved, reopened on a "new device" | Walk in both engines | Works **[V]** |
| Your details and today's date; typed answers pass over them | Unit tests; walk in both engines | Works **[V]** |
| Signing with a drawn signature | Unit test; walk in both engines | Works **[V]** |
| Many copies from a CSV | Unit test and CLI test; page step passes in CI | Works **[V]** in Node; the page step fails locally only because it opens a PDF first |
| Answers handed over in the link (`#answers=`) | Walk in both engines | Works **[V]** |
| Paste a screenshot; drop a file | Paste: both engines. Drop: WebKit 26 and Chrome 156 | Works **[V]** |
| Installable, with a service worker and version in the footer | Walk in both engines | Works **[V]** |
| Offline after first visit | Walk in Chromium 143 | Works there **[V]**; inconclusive in WebKit |
| Handwriting cut into lines | Unit test | Works **[V]** |
| Handwriting read on the device (Quick model, Node) | `npm run check:handwriting` | Runs; 4 of 5 synthetic lines right **[V]** |
| Radio buttons shown one per choice | CI; WebKit 26 | Works **[V]** |

## What is partial

- **Handwriting.** The plumbing works; accuracy is measured only on handwriting-style fonts, and the number does not
  reproduce (4.3% here against 1.4% in the README). The README already says real handwriting is unmeasured. **[V]**
- **Photos taken at an angle.** Rotation is corrected, perspective is not. (Patch 0002 adds it; see below.) **[V]**
- **Blank labels.** Good for a line with its label on the left. Wrong for checkboxes and missing for table cells (see
  defects 4 and 5). Labels decide what your details fill and which CSV column goes where, so this limits anything
  that matches blanks to stored data. **[V]**
- **Your details.** Ten fields, plain text, in the browser's `localStorage`. No ID numbers, no employer, no history.
  **[V]**
- **"Send…".** Present where the browser can share files (WebKit says yes; Chromium on a Mac says no). Never
  exercised by a test. **[V]**
- **Problems list.** The only pre-flight today: it reports a choice the form does not offer, text cut to a field's
  maximum, and answers left over. Nothing about blanks left empty, missing signatures, dates or conflicts. **[V]**
- **Traceability.** The page knows which values came from your details ("filled for you") and each PDF records the
  form's and the answers' SHA-256. Nothing records where each individual answer came from. **[V]**

## What is broken

Numbered so later phases can refer to them. All were reproduced unless marked.

1. **WebKit finds blanks that are not there.** On the invented flat PDF the ring of the "Q" in "Qty" becomes a
   checkbox (14 blanks, should be 13). On the invented fillable PDF a phantom line appears above the title (10 blanks,
   should be 9). Every answer after the phantom lands one blank late: in the walk, the e-mail field received the phone
   number. Photos are unaffected. Chromium draws the same PDFs slightly differently and does not trip. **[V]** in
   Playwright WebKit 26.0; real Safari and Tauri not tried.
2. **PDFs do not open in Chromium 143.** The page shows `this[#s].getOrInsertComputed is not a function`. pdf.js 6.5
   calls `Map.prototype.getOrInsertComputed`, which that browser lacks. An older phone or an un-updated browser gets
   the same. pdf.js ships a `legacy/` build meant for this. **[V]** the failure; **[I]** that the legacy build fixes
   it.
3. **A flat PDF over 10 pages loses pages on export.** The page reads only the first 10 pages and says the others "are
   kept as they are". That is true when the PDF has its own fields. For a flat PDF the output is rebuilt from the pages
   shown: a 12-page source came out as 10 pages, editable and print-ready alike. **[V]** in the library with the inputs
   the page gives it; the page path itself by reading.
4. **Checkboxes get the wrong label.** A checkbox's label is taken from the words to its left, but a checkbox's
   caption is usually on its right. On the invented form the Day box is labelled "Shift" and the Night box "[] Day"
   (both engines). A CSV column named "Day" then ticks the **Night** box. **[V]**
5. **Table cells have no labels.** Every cell under a header row is labelled "blank". **[V]** **Fixed in 2.4.0**
   where the header can be checked. The page's own read does not return the words of a ruled header row, so each
   header cell is now read on its own, twice: as it is, and from a copy enlarged twofold. The column's cells (two
   empty rows or more) take the header only when:
   - the two reads agree letter for letter, but for misread letters told by their neighbours ("[" or "|" for "I"; "l"
     or "I"; "0" for "O" or "o");
   - the first read is at least 60% sure;
   - the header row is the table's top row, closed by a rule over it and the column's own walls.

   Otherwise they stay unlabelled. These cells are never filled with the user's details. **[V]**

   It was measured on a frozen invented set built to trip it, by a separate agent that did not see the code: 18 pages,
   75 header cells over 232 body cells. The headers included ordinary ones, "#", "No.", "ID", two-line headers,
   handwriting, two smudges, two logos, two scribbles, two empty headers, and photographed copies. **[V]**
   - First run: one wrong name. "price" sat in the top cell of a "Unit price" column; the page's read had already
     given that cell this word before this change.
   - The rule then gained the top-cell part, and the set is no longer blind on that case.
   - An independent review of the code then found six ways to a wrong name that the set did not cover, each
     reproduced on pages of its own, and they were closed:
     - a column run on across a boxed form's caption rows, or into a second table;
     - a cramped header cut at the wall ("Neight");
     - a filled-in row taken for the header;
     - a misread letter settled one fixed way ("TotaI");
     - a row's own label taken for part of the header ("AM" in "NAME");
     - a caption over a single field taken for a column.
   - Final run on the same set: no cell named wrong. 167 of the 193 cells found under a real header were named, and
     26 left blank; all 32 under a header with no words stayed blank.
   - 7 cells were not found at all, on two photos straightened 0.1° too far (1.4° for a 1.3° turn, 1.0° for 0.9°).

   The misread repair names "Item" twice where the reads were "Item" and "[tem", and lets no smudge, logo or scribble
   through. The 60% threshold now rests on 72 header cells, read twice each. 3 first reads fall between 50% and 70%.
   At 50% one more right name and one wrong one ("Ne" for "No." on a photo); at 70% one right name fewer ("Item").
   **[V]**

   Left as limits:
   - Two reads can agree on the same misreading ("lbs" read "Ibs" both times). **[V]** on a page of the review's.
   - A table directly under another with the same columns has no header read. **[V]**
   - A form remembered by 2.3.x keeps its labels until *Find the blanks again*. **[I]** from the code.
6. **Dark mode hides the form.** With the system in dark mode, every blank on the form is a solid black bar, and the
   "Opening the form…" banner is pale text on a pale box. Seen on the live page. **[V]**
7. **Blank numbers cover the start of each label.** Known; the README says so. **[V]**
8. **Your details and saved signature are readable by other sites of yours.** They sit in `localStorage` in plain
   text, and `localStorage` belongs to the whole origin `swixixle.github.io`, not to `/form-filler/`. Any other project
   page published under the same GitHub account can read them, and write them: the saved signature's image address
   is the one stored value the page writes into itself without escaping. **[V]** the storage and the unescaped
   value; **[I]** the cross-project reach (how browsers scope storage; not tested).
9. **`npm run walk` does not work after `npm ci`**, and fixtures cannot be redrawn on a Mac (see "Not verified").
   **[V]**
10. **No licence file.** The repository is public with no licence. By default that reserves all rights: others can
    read and fork it on GitHub but have no permission to use it, and there is no warranty disclaimer. **[V]** that it
    is missing; **[I]** the legal effect (general knowledge, not legal advice).

11. **Blanks that are not there, in tables with tight rows** (found 2026-11-17, after this inventory was written). In a
    table whose rows are about 61 px high at the page's working width of 1700 px (22 pt on a Letter page), the upright
    strokes of a header's letters are long enough to pass for cell walls. The header cell is split, and parts of it
    are offered as blanks. On the invented `tests/fixtures/tight-table.png` the finder returns 8 blanks where there
    are 6. Every answer typed in order after such a blank lands one blank late. Rows of 70 px, like the invented
    equipment form's, escape it by a few pixels. **[V]**

    **Fixed in 2.3.1.** The rows are cut where they were, so no cell that 2.3.0 found is lost, but beside a stroke that
    is surely a letter (more than 3 px clear of both rules, with other ink within 9 px of it) the pieces are judged
    again: a header's piece over an empty cell of its column is dropped, a piece among a word's letters is dropped, and
    the room after a word starts where the word ends. It was measured cell by cell against 2.3.0. The measure covered
    465 invented pages: the fixtures, 360 tables with rows of 14 to 40 pt on Letter, A4 and Legal paper in six fonts,
    and 90 photo-like copies. It also covered a held-out set, two stress sets, and the pages of two attackers. The
    attackers drew units at the right of a box ("Weight ___ kg"), two fields in one box, rounded and comb boxes, walls
    drawn short of the rules, broken walls and timesheet ticks. On all of them, no cell is lost that 2.3.0 found, and
    no blank is offered that 2.3.0 did not offer. The pieces among letters fall from 430 to 12 on the 360 tables and
    from 113 to 56 on the photos. **[V]**

    Left as they were:
    - a letter within 3 px (about 1 pt) of a rule, or blurred into one on a photo;
    - a lone stroke with nothing beside it;
    - a header over a column of row labels.

    One case now behaves as roomy rows always did: a labelled field over an empty box ("Holder: ___" over an empty row)
    is taken for a table's header, and its blank is dropped. On the fix's own probe page that cost 11 of 32 places.
    **[V]** The test in `tests/blanks.test.js` passes now, beside tables drawn in code, and three of these limits are
    tests marked "todo".

12. **A header cell with small or short words is offered as a blank** (found 2026-11-19, measuring defect 11's fix;
    2.3.0 and 2.3.1 alike). Its words have less ink than the finder's limit for a scan's specks, so the cell is taken
    for an empty one: 7 to 9 pt print, or a word like "ID", "No." or "Qty". On the measure's 360 invented tables, 562
    of 1,410 header cells are offered as blanks this way; of the 7 pt headers on Letter paper, 44 of 65. Every answer
    typed in order after one lands one blank late. **[V]**
13. **Photographed tables lose cells** (found the same way; both versions). On the measure's 90 photo-like copies
    (turned, shaded and softened, then straightened as the page does), 270 of 834 empty cells get no blank. **[V]** the
    count; the cause is not looked into yet.
14. **Tight rows on Legal paper are not found** (both versions). The finder skips a row whose inside is under 0.6 of
    its text unit, and the unit grows with the page's height: on a Legal page it is 62 px, so a row must be over 37 px
    (about 13.4 pt) inside. On the measure, tables with 14 pt rows on Legal paper lose 76 empty cells, and one with
    16 pt rows 2. **[V]**
15. **Seen on single invented pages, not measured at scale** (both versions). Each was seen on one attacker's page, the
    same in 2.3.0 and 2.3.1. **[V]**
    - A header row of white words on a dark fill: no cell of the table is found.
    - A section row across a table, where the column walls stop at it, is offered as a blank.
    - In a tight cell, the space right of a checkbox ("Agreed [ ]") is offered as a blank.
    - A roomy box with a unit at its right ("Weight ___ kg") gets no blank: the unit's ink runs to the wall.
    - 6 pt checkboxes on an A4 checklist are not found.
16. **A CSV's columns go stale when a blank is added or removed by hand** (found 2026-11-19 by the review of 2.3.0; in
    2.2.0 too, and still in 2.4.0). The page matches a CSV's columns to blank numbers once, when the CSV is opened
    (`src/app/main.js:509`). Adding a blank by hand (`:604`) or removing one (`:526`) changes the numbers, but the
    columns are not matched again, so the listing and the copies use the old numbers. **[V]** run on 2.4.0's build in
    Chromium, with the invented `form.png` and a CSV with one column, "Day", and "x" under it:
    - Before: the listing reads "Day → blank 10 (Day)".
    - After removing blank 1 (Name) by hand: it reads "Day → blank 10 (Night)".
    - In the copy, the X is at 168.8 to 173.2 pt across, inside the Night box (167.4 to 174.6 pt), not the Day box
      (95.4 to 102.6 pt).

    Each column matched to a blank after the one removed (or after the one added) then points one blank off. So in
    every copy those answers land in the wrong blank, here a wrong tick. *Find the blanks again*, opening another form
    and opening a template all drop the CSV, so they are safe. **[V]** from the code.

    **Fixed in 2.4.1.** Each column now keeps to the blank it was matched to when the CSV was opened, by the blank's id,
    not its number. A blank added or removed by hand moves the numbers, not the columns. A column whose own blank is
    removed says "its blank was removed" and fills nothing. Matching the columns again by name was not done: a CSV made
    against the form as it was means its "4" to stay with that blank, not with whichever blank is 4 after a change.
    **[V]**
    - The new walk step (remove blank 1, add a blank before the Day box, make the copy, remove the Day box) passes on
      2.4.1, and fails on 2.4.0's build at "blank 1 removed".
    - A unit test pins the same cases, and pins that the old numbers would have ticked the Night box.

Smaller notes: the repository has no git tags, so 2.0.0 and 2.1.0 exist only in `CHANGELOG.md` and `package.json`.
## The patches

`form-filler-patches-2026-11-13a/` sits beside the repo: five patches and a `SHA256SUMS`.

- **Checksums: all five match.** `shasum -a 256 -c SHA256SUMS` printed OK for each. **[V]**
- **None of them is in `main`.** **[V]**
- **None applies to `main`.** `git apply --check` fails for all five. **[V]**
- **They were written against `777dda7`** ("README for v2…", 13 November), four commits behind today's `main`. On that
  commit the whole series applies cleanly with `git am` (resulting tree `4cca8397…`). The four commits since then
  rewrote the same parts of `src/app/main.js`, `style.css`, `walk.cjs` and `README.md`. **[V]**, in a throwaway clone;
  the real repository was not touched.
- **On their own base, 29 tests pass and one test file cannot start.** `tests/capture.test.js` stops at its first
  line because it calls `ffmpeg`, which did not run on the test machine; that is the machine, not the patch. So patch 0002's
  capture and flattening tests are **unverified here**. Their browser walk was not run. **[V]**

"Already in main" below was measured by counting each patch's added lines that appear word for word in `main`'s copy
of the same file.

| Patch | What it adds | In main? | `git apply --check` on main | Would conflict in |
| --- | --- | --- | --- | --- |
| 0001 Handwriting that learns | `src/lib/reader.js`, `learning.js`, `src/app/hand-store.js`, tests: per-character confidence, other readings, readings shaped to what a blank expects (dates, phones), learning from your corrections, kept in IndexedDB | **No.** 2 of 374 added lines; all four new files absent | Fails: `walk.cjs`, `main.js`, `style.css` | `main.js`, `style.css` |
| 0002 Camera, video, angled photos | `src/lib/capture.js`, `page.js`, `src/app/capture-ui.js`, two fixtures: auto-shutter, clearest frame of a video, the sheet found and flattened (perspective), stricter blank thresholds | **No.** 2 of 426 added lines; all new files absent | Fails: `walk.cjs`, `main.js`, `style.css` | `main.js`, `style.css` |
| 0003 Answers lettered like the form | `src/lib/lettering.js`, `src/app/lettering.js`, two fixtures: print size and face (sans, serif, typewriter) matched to the form; `--lettering`; number tags moved off the labels | **No.** 10 of 208 added lines (9 of them are lines of the fixture script that both sides already had) | Fails: `walk.cjs`, `main.js`, `style.css`, `lib.test.js`, and it deletes a file `main` never had | `walk.cjs`, `main.js`, `style.css`, `lib.test.js` |
| 0004 Share button | Share out through the share sheet with a download fallback; share **in** (a web share target in the manifest and service worker); ffmpeg in CI | **Partly, by other code.** `main` has its own "Send…" button (commit `7a9f42a`) doing the share-out. Not in `main`: the download fallback, receiving shares, ffmpeg in CI. 5 of 92 added lines | Fails: `main.js` | `main.js` |
| 0005 README and exports | README sections for all of the above; exports the new modules from `src/lib/index.js` | **No.** 0 of 41 added lines | Fails: `README.md` | `README.md` |

Things to know before anyone applies them:

- **0002 leaves a debug file in history.** It adds `dbg.tmp.mjs` at the repository root and 0003 deletes it. Harmless,
  but it will be in the log. **[V]**
- **0002 changes the blank finder's thresholds** (a line must be 3.2 text heights long, was 2.5; a checkbox at least
  0.4), "so … the ring of a Q [is] not taken for blanks". That is defect 1's first symptom. Whether it cures it in
  WebKit is **untested**. **[V]** the change; **[I]** the link.
- **0001 keeps pictures of your handwriting in IndexedDB, unencrypted.** Under the plan that belongs in the vault.
  **[V]**
- **0004's receiving half does not work on an iPhone**, by its own description (Safari does not let installed pages
  receive shares). **[V]** that the patch says so.
- **0004 and `main` now both solve "send the PDF".** One has to be chosen when the series is rebased. **[V]**
- **0003 fixes defect 7** (numbers over labels) by moving the tags. **[V]** that it claims to; not run.

They are worth keeping: 0002 is most of phase 6's capture and all of its perspective correction; 0001 is the
"handwriting with mandatory review" groundwork. But they need rebasing by hand onto today's `main`, not `git am`.

## Where the code and the plan disagree

Ordered by how much each will cost if ignored.

| # | The plan says | The code today | Mark |
| --- | --- | --- | --- |
| 1 | Laptop is a Tauri shell; phone is a web app on an iPhone | Tested only in Chromium. Both planned surfaces are WebKit, where defect 1 misplaces answers | **[V]** |
| 2 | "Any PDF on the laptop" | 10-page cap, with pages lost on flat PDFs (defect 3); PDFs fail outright on an older engine (defect 2) | **[V]** |
| 3 | An encrypted vault holds your profile | Plain text in `localStorage`, reachable from sibling sites (defect 8) | **[V]** / **[I]** |
| 4 | Every document in or out is kept in an archive | Nothing is kept. An export is a browser download; the only memory is a form's blank positions | **[V]** |
| 5 | Match blanks to the vault | Matching is by label words, and labels are wrong for checkboxes and absent for tables (defects 4, 5). Your details never fill a checkbox or a choice | **[V]** |
| 6 | Every answer traceable to its source | Only "came from your details" is known, and only while the page is open | **[V]** |
| 7 | Pre-flight: blanks, signatures, dates, conflicts | Only three field-level problems are reported | **[V]** |
| 8 | Flat PDFs: pdf.js **and OpenCV.js** | pdf.js and the repo's own pixel finder; no OpenCV. A choice for phase 3: keep the tested finder, or replace it | **[V]** |
| 9 | Anything online is opt-in and shows what is sent | True of your data. The handwriting model download is announced as it starts but not asked for first | **[V]** |
| 10 | A clear no-warranty licence | No licence file (defect 10) | **[V]** |
| 11 | Local first | Every push to `main` publishes to a public web page. Fine for the page; it means desktop-only work must stay inert in the web build, and nothing personal may ever enter this repository | **[V]** |
| 12 | Tauri | The repository has never used Rust, which Tauri needs | **[V]** |

Where they already agree: nothing is signed, sent or submitted without your tap; handwriting is always shown for
review before it is used; the page installs to a home screen; the library is cleanly separate from the page, so a
desktop shell, a phone app and an extension can share it. **[V]**

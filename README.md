# Form Filler

Photograph or open a form, write your answers anywhere as plain lines, and get the form back filled in: as a PDF you
can still edit, a print-ready PDF, or printed. Everything happens in the browser on your own device; nothing is
uploaded.

## How it works

1. **The form.** A photo, a scan or a PDF. A photo taken a little crooked is straightened. The blanks are found from
   the page's own lines, not guessed: a line to write on, an empty box or table cell (to the right of, or under, a
   short label), and a checkbox. A table's header row is not a blank. Each blank is labelled with the words beside it.
2. **Your answers**, typed, dictated with the keyboard's microphone, or read from a photo of your own page:
   - a **period** or a **new line** moves to the next blank; a blank line between lines is the same single step;
   - a lone **-** (or an extra period, ". .") leaves a blank empty;
   - **4)** or **4:** at the start puts that answer in blank 4 ("4:30" is a time, not a blank number);
   - a period inside a number (7.38), after an initial (J. Smith) or a short title (Dr. Mr. St.) stays in the answer;
   - for a checkbox, **x** or **yes** ticks it.
3. **The filled form.** Every answer sits in its blank on the page and can be changed right there. A blank the finder
   missed can be added by dragging across it. Download:
   - **PDF you can still edit**: the form's own page (the original PDF page itself when it came as a PDF) with a
     fillable field over each blank, holding your answer;
   - **print-ready PDF**: the answers written onto the page.

Each download shows its SHA-256, with the form's and the answers', and the PDF's subject line records the form and
answer fingerprints.

## What it cannot do (yet)

- **Handwriting.** The text reader (Tesseract) is built for print. Neat printed handwriting sometimes reads; joined-up
  handwriting mostly does not. What it read goes into the answers box to be corrected first, never straight onto the form.
- **A photo taken at an angle** (not just turned): the page is straightened for rotation only, not perspective.
- **Blanks with no line or box**, such as a gap after a colon: add them by hand.
- **Fonts**: answers are set in Helvetica; letters it cannot draw are swapped for plain ones.

## Run it

```sh
npm ci
npm test               # the blank finder and the answer rules, on invented forms
npm run build          # makes dist/
node scripts/walk.cjs dist   # the whole flow in Chromium at phone size (needs Playwright and pdftotext)
```

Or unpack a release folder and run `python3 serve.py`.

The test forms in `tests/fixtures` are invented (`scripts/make-fixtures.py` draws them).

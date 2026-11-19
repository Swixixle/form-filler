# Changes

## 2.3.1 (2026-11-19)

- **Tables with tight rows.** In rows under about 25 pt, the upright strokes of a header's letters passed for cell
  walls, so the header cell was split and its pieces were offered as blanks. Every answer typed after them landed one
  blank late. Now a piece beside a stroke that is surely a letter is not offered. The rows are still cut where they
  were, so every cell 2.2.0 and 2.3.0 found is still found:
  - walls drawn short of the rules, broken or rounded;
  - a box with a unit at its right ("Weight ___ kg");
  - two fields in one box ("Signed ___ Date ___").

  On 360 invented tables the pieces fall from 430 to 12, with no cell lost and no blank added.
- **Still left.** A letter within about 1 pt of a rule can still split its cell, more often on photos. A labelled
  field over an empty box ("Holder: ___") is taken for a table's header, as it already was in roomy rows. The
  measure found four older defects, logged in `docs/INVENTORY.md` (12 to 15). The worst is a header cell in small
  print or with a short word ("ID", "No."), which is offered as a blank.

## 2.3.0 (2026-11-19)

- **Checkbox labels.** A checkbox is labelled by its own caption, on its right ("[ ] Yes") or its left ("Yes [ ]"),
  judged for the whole group of boxes on its line. Before, it took the words on its left: on the invented form the box
  beside "Day" was called "Shift" and the Night box "Day", so a CSV column "Day" ticked the Night box.
- **Never a guess.** When the words that belong to a box cannot be told, the box is listed as unclear, with the words
  it might be, and no CSV column goes to it. That covers a word as near one box as the next, a note, number, code or
  price beside a caption ("Yes – go to Q8", "Adult $12", "500 ml"), answer codes, a caption that may run on to the
  next line, headings over boxes that have words beside them too, and a lone box between a question and another
  field's prompt or a note ("Member? [ ] Number: ___", "Paid? [ ] (optional)"). The rule leans to unclear: some
  captions a person could tell are left unclear as well. Notes, prices and codes it does not recognise ("Adult
  12pp", "Daily DY") can still end up in a box's name; the tests list them as known limits.
- **Forms and templates from an earlier version** keep their blanks and old labels, so blanks added or removed by hand
  are not lost, and say so; *Find the blanks again* names their checkboxes anew.
- A CSV column named like both a checkbox and the line its caption names ("[ ] Other: ____") goes to the line, as
  before. `form-filler check` lists an unclear checkbox with the words it might be.
- In the library: `labelBlanks` labels a page's blanks; `cleanWords` drops the reader's words for a checkbox's square
  and recovers a caption the reader ran into it. Templates keep `unsure`, and mark labels made this way (`labels: 2`).

## 2.2.0 (2026-11-17)

- **Safari, iPhone and other WebKit browsers:** two things that are not blanks were taken for blanks on PDFs there (the
  ring of a "Q" as a checkbox, the tops of a bold heading's letters as a line), which put every later answer one blank
  late. A checkbox must now have corners, and a line must be ink nearly all the way along with nothing hanging from
  it. The whole page is now walked in WebKit as well as Chromium, on every push.
- **Older browsers:** a PDF now opens in a browser a year or two old (it stopped with "getOrInsertComputed is not a
  function").
- **Long PDFs:** a PDF with no fields of its own and more than 10 pages lost every page after the tenth in the filled
  copy. All pages are kept now, in order. In the library, `buildPdf` keeps a source PDF's unlisted pages unless
  `keepOtherPages: false` is given.
- **What the browser kept is checked before it is used:** a saved signature must be a PNG picture, and saved details
  must be text.
- **Round option buttons** drawn on a flat page: the library can find them, each set as one choice (`findOptions`,
  `nameOptions`). The page does not use them yet.
- **Privacy in the repository:** a gate stops any commit that carries personal information, on the maintainer's
  computer and again on GitHub (`never-list/README.md`).
- MIT licence. The README is rewritten for what works today, with new pictures, and the plan is kept apart under
  "Roadmap". The planning documents are in `docs/`.

## 2.1.0 (2026-11-16)

- **Answers on paper, by number.** Write each answer after its blank's number ("3 Jane Roe"), in any order, photograph
  the page, and each goes to its blank. A line whose number cannot be read is left out and named, not put in order.
- **Send.** The filled PDF goes to Mail, Messages or anything else the device's share sheet offers.
- **Radio buttons** in a PDF get a button over each of the form's own, instead of one box over them and their words.
- **On a computer:** drop or paste a form onto the page; the answers box gets the cursor and sits beside the form;
  ⌘S / Ctrl+S downloads the editable PDF.
- The answer rules are one line, with the rest folded away. Blank numbers are a little larger on wide screens.
- **No old copies:** the page names its version at the foot, looks for a newer one each time it is opened, and moves
  to it by itself (if a form is open, it says so and waits).
- The README shows the paper workflow with screenshots of the live page.

## 2.0.0 (2026-11-13)

A library apart from the page; a PDF's own fields as blanks; templates; your details and today's date; signing;
many copies from a CSV; handwriting read on the device; offline; tests and the GitHub Pages deploy.

## First version (2026-11-13)

Blanks found from a form's own lines, filled from loose answers, out as an editable or print-ready PDF.

# Changes

## 2.5.0 (2026-11-20)

- **The archive, as a library and on the command line** (phase 2, slice 2). A plain folder of everything that came
  in or went out, filed by matter: each item is a dated folder ("2026-11-17 sent IRS - Form 1040") holding its files
  behind role words and a `record.json` with each file's SHA-256. Nothing in it is ever deleted or overwritten: the
  archive works through a file interface that has no delete and no overwrite, a name that is taken gets " (2)", and a
  record that changes is written anew with the old one kept. An item nobody filed goes to `_Unsorted`. The index
  (`.formfiller/index.json`) is a cache, kept up to date and made again from the records at any time, so the folders
  can be rearranged in Finder; `verify` reads every file again and says what is missing, changed or not recorded,
  which items the index knew have left the archive, and what a stop left unfinished, and changes nothing. One program
  at a time changes an archive (a lock in `.formfiller`; one left by a program that stopped is taken over).
- On the command line: `form-filler archive add`, `file`, `move`, `index` and `verify`. Their flags are read
  strictly: one the command does not know, one given twice or one with no value is refused, so a file is never taken
  for a flag's value and left out.
- In the library: `openArchive`, `readRecord`, `cleanName`, `matterPath`, `itemsWithFile`, and `nodeFiles` (from
  `form-filler/files/node`), the file interface over Node.
- One SHA-256 helper (`src/lib/hash.js`) for the page, the library and the command line, which each had their own.
- The page does not use the archive yet; the Mac app will.

## 2.4.1 (2026-11-19)

- **Many copies from a CSV, after blanks are changed by hand.** The page matched a CSV's columns to blank numbers once,
  when the CSV was opened. Adding or removing a blank by hand afterwards moved the numbers, so the columns for the
  blanks after it landed one blank off: on the invented form, removing blank 1 sent a "Day" column to the Night box
  (defect 16, in 2.2.0 too). Now each column keeps to the blank it was matched to, and a column whose own blank is
  removed says so and fills nothing. A walk step makes the copies after removing and adding blanks, and checks that
  the tick is in the Day box.
- In the library: `columnIds` and `columnsNow` keep a CSV's matched columns to their blanks, by each blank's `id`.

## 2.4.0 (2026-11-19)

- **Table cells named by their headers.** A cell under a table's header row was listed as "blank". Now, in a table with
  two empty rows or more, it is listed by its column's header ("Item", "Serial number", "Qty"), so the list shows what
  goes where. The page's read of a whole form does not return a ruled header row's words, so each header cell is read
  on its own instead, twice: as it is, and from a copy enlarged twofold. The cells are named only when all of these
  hold:
  - both reads say the same, letter for letter, but for misread letters told by their neighbours ("[tem" for "Item",
    "TotaI" for "Total", "N0." for "No.");
  - the first read is at least 60% sure;
  - the header row is closed by a rule over it and the column's walls, and is the table's top row.

  Otherwise they stay "blank": a wrong name is worse than none.
- **Measured on an invented set made to trip it:** 75 headers, including smudges, logos, scribbles, handwriting,
  two-line and one-character headers, and photographed copies. No cell was named wrong. Of the 193 cells found under a
  real header, 167 were named and 26 left blank, mostly under handwritten or photographed headers. The 32 cells under a
  smudge, logo, scribble or empty header all stayed blank. An independent review then found six ways to a wrong name
  that the set did not cover, and they are closed:
  - a column run on across the caption rows of a boxed form, or into a second table;
  - a cramped header cut at the wall ("Neight" for "Weight");
  - a filled-in row taken for the header;
  - a misread letter settled one fixed way;
  - a row's own label taken for part of the header;
  - a caption over a single field taken for a column.
- A table's first row could already take words from its header when the page's read reached them, sometimes only part
  of a header ("price" for "Unit price"). Such a label (whole words of the header) now becomes the whole header once it
  reads the same twice, and is dropped when it does not.
- **A cell named from its column's header is never filled with your details** or today's date, whatever the header
  says: a "Name" or "Date" column belongs to many rows. A single field under its own caption cell is no table and is
  filled as before.
- A CSV column named like a header goes to the form's own blank of that name, if it has one ("Name:" over a table with
  a Name column); the table's cells alone match no column (which row would it be?). Columns by number still reach them.
- A template with cells named from a header says version 2, which older versions of the program refuse rather than
  fill every row of a Name column with one name.
- No new download: the header reads use the same reader as the rest of the page. On the invented form (three
  headers) they add about a tenth of a second to finding the blanks: 85 to 140 ms, measured in Chromium and WebKit on
  a Mac.
- Known limits:
  - Two reads can agree on the same misreading (a column headed "lbs" is read "Ibs" both times, and named so).
  - A table directly under another with the same columns has no header read: its walls run on up into the first.
  - A form remembered by an earlier version keeps its labels until *Find the blanks again*.
- In the library: `headerLabels` names a page's table cells from two reads of each header cell, given a function that
  reads a small picture; `headerCells` and `headerLabel` are its parts. A template keeps the mark (`column: true`).

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

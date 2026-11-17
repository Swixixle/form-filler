# Changes

## Not yet released

- **Safari, iPhone and the Mac app (WebKit):** two things that are not blanks were taken for blanks on PDFs there (the
  ring of a "Q" as a checkbox, the top of a bold heading as a line), which put every later answer one blank late. A
  checkbox must now have corners, and a line must be ink all the way along with nothing hanging from it. The whole
  page is now walked in WebKit as well as Chromium.
- **Older browsers:** a PDF now opens in a browser a year or two old (it stopped with "getOrInsertComputed is not a
  function").
- **Long PDFs:** a PDF with no fields of its own and more than 10 pages lost every page after the tenth in the filled
  copy. All pages are kept now, in order.
- **What the browser kept is checked before it is used:** a saved signature must be a PNG picture, and saved details
  must be text.
- **Privacy:** a gate stops any commit that carries personal information (`never-list/README.md`). MIT licence.

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

# The never-list

This repository is public. The never-list is the set of things that must never be committed to it: the owner's name,
birthdate and addresses, Social Security, licence, routing and account numbers, and any real document.

A gate checks every commit against it, **before the commit exists**, and again on GitHub. It is the second item of the
plan's privacy wall ([docs/BUILD_PLAN.md](../docs/BUILD_PLAN.md)).

## Turn it on (once per copy of the repository)

```bash
npm run hooks
```

That points git at the hooks in `.githooks/`. From then on `git commit` runs the gate by itself.

## What it stops

| | Where the rule lives | Checked on your Mac | Checked on GitHub |
| --- | --- | --- | --- |
| **Shapes**: a Social Security number that could be real; any nine-digit number that could be one, or a routing number; a value written after "account number", "licence number", "date of birth"; an e-mail address that is not an invented one; a home-folder path with an account name in it | `scripts/never-list.mjs` (patterns only, no real value) | Yes | Yes |
| **Your own values**: your name, birthdate, addresses, licence and account numbers, however they are spaced, cased or punctuated, even inside a longer word | Nowhere as themselves. `never-list/local.txt` holds a keyed fingerprint of each; the key is in your Mac's Keychain | Yes | No (GitHub has neither) |
| **Files that are not text**: a picture, PDF, video or archive must be listed in `invented-files.txt`. A PDF's text is also read and checked | `never-list/invented-files.txt` | Yes | Yes |
| **Files that belong elsewhere**: `local.txt` itself, encrypted vault files (`.age`), anything from the archive or backup folders | `scripts/never-list.mjs` | Yes | Yes |
| **Commit messages** | the same rules | Yes | Yes |

When it stops a commit it says which file and line, and what kind of thing it found. **It never prints the value**,
only its last four characters.

## Your own values

**They are not kept anywhere.** When you add a value, the gate keeps only a keyed fingerprint of it in
`never-list/local.txt`: HMAC-SHA256 of the value's letters and digits. The key is one item in your Mac's login Keychain
(`form-filler.never-list`). It is not in the repository and not in that file, so the file can be read, copied, backed
up or leaked without giving a value away. Git ignores the file, and the gate refuses to commit it all the same.

To check a file, the gate reduces its text to letters and digits the same way and fingerprints every stretch of it as
long as one of your values. That is why a value is found however it is spaced or punctuated, and inside a longer word.

Add a value. You are asked what kind it is and then to type it twice; what you type is not shown:

```bash
npm run never-list -- add
```

See how many values of each kind are on the list (the values themselves cannot be shown; they are not there):

```bash
npm run never-list -- list
```

Take a value off again (typed, not shown):

```bash
npm run never-list -- remove
```

What follows from keeping it this way:

- **A new Mac, or a deleted Keychain item, means adding your values again.** The fingerprints are useless without the
  key, to you as much as to anyone.
- **If the key cannot be read, the gate refuses the commit.** It never skips your values.
- **The key is as safe as your login.** Anything running as you on your unlocked Mac can ask the Keychain for it the
  way the gate does. With the key and the file it could test guesses against the fingerprints; it still could not
  read a value out of them.
- You do not need to add your Social Security number or bank numbers: their shapes are already stopped wherever they
  appear. The list is for what has no shape: a name, an address, a birthdate, a licence number.

## Invented material

Tests, screenshots and examples use invented people and invented forms only. Two lists say what is invented:

- **`invented-files.txt`**: every picture, PDF or other non-text file, with its fingerprint. A new one is refused until
  someone lists it, which is the moment to look at it and be sure it is not a real document:

  ```bash
  npm run never-list -- vouch tests/fixtures/new-form.png
  ```

- **`invented.txt`**: an invented value that has a real shape, such as a made-up account number in a test. For a
  Social Security number, use one that was never issued (987-65-4321 is the usual one); those pass without listing.

## Check everything by hand

Every tracked file and every commit ever made:

```bash
npm run never-list -- --all --history
```

## What it cannot do

- **Who made a commit is checked only on your Mac, and only against your own values.** The author and committer
  that git stamps on a commit (`git config user.name` and `user.email`) are not file contents. Before a commit is made
  the gate refuses one whose author or committer line holds a value on your list. It does not check commits already
  made, and GitHub does not check this at all.
- **It does not read pictures.** A photo of a real form cannot be recognised, which is why every picture has to be
  listed by a person.
- **It can be skipped** with `git commit --no-verify`. The check on GitHub still runs, but GitHub only knows the
  shapes, and by then the commit has been pushed.
- **It cannot take back what is already public.** It only stops new commits.

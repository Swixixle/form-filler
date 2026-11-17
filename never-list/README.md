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
| **Your own values**: your name, birthdate, addresses, licence and account numbers, however they are spaced, cased or punctuated | `never-list/local.txt`, on your Mac only | Yes | No (GitHub never has them) |
| **Files that are not text**: a picture, PDF, video or archive must be listed in `invented-files.txt`. A PDF's text is also read and checked | `never-list/invented-files.txt` | Yes | Yes |
| **Files that belong elsewhere**: `local.txt` itself, encrypted vault files (`.age`), anything from the archive or backup folders | `scripts/never-list.mjs` | Yes | Yes |
| **Commit messages** | the same rules | Yes | Yes |

When it stops a commit it says which file and line, and what kind of thing it found. **It never prints the value**,
only its last four characters.

## Your own values

They are kept in `never-list/local.txt`. Git ignores that file, the gate refuses to commit it, and only you can read
it. Nothing else reads it.

Add a value. You are asked what kind it is and then to type it twice; what you type is not shown:

```bash
npm run never-list -- add
```

See what the list holds, masked:

```bash
npm run never-list -- list
```

You do not need to put your Social Security number or bank numbers in the file: their shapes are already stopped
wherever they appear. The file is for what has no shape: a name, an address, a birthdate, a licence number.

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

- **It does not see who made a commit.** The author name and e-mail address that git stamps on each commit are not
  file contents. They are set with `git config user.name` and `git config user.email`.
- **It does not read pictures.** A photo of a real form cannot be recognised, which is why every picture has to be
  listed by a person.
- **It can be skipped** with `git commit --no-verify`. The check on GitHub still runs, but GitHub only knows the
  shapes, and by then the commit has been pushed.
- **It cannot take back what is already public.** It only stops new commits.

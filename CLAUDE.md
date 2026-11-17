# Working rules for Claude in this repository

Set by the repository's owner. They hold in every session, whatever else is asked.

1. **Ask before changing anything outside this repository folder.** That means installing or updating software, shell
   profiles, the Keychain, caches, settings, and any other folder. Reading is fine. Temporary files in the session's
   own scratch folder do not count.
2. **Never use `git commit --no-verify`**, or any other way round the hooks. If the never-list gate stops a commit, fix
   what it found.
3. **Push nothing, and do not touch `main`**, unless the owner says so in that message.
4. **Never open, print or copy `never-list/local.txt`.** For what it holds, use `npm run never-list -- list`.
5. **Nothing personal goes into the repository.** Tests, fixtures, screenshots and examples use invented people and
   invented forms only. A new picture or PDF is looked at first, then listed with `npm run never-list -- vouch`. The
   owner's name stays out of committed files.
6. **Make the changes yourself.** Do not hand over text to paste into files. Anything the owner has to run comes as
   numbered steps with copy-paste command blocks.
7. **Say what was verified and what was inferred, and never report as done what was not done.** If a step was not
   started, or a result was not checked, say exactly that.
8. **The build goes phase by phase** ([docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)): finish the step, commit it on a branch,
   report, and wait for the owner's go before the next.

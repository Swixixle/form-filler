# The shell spike: what it found

Slice 1 of [PHASE2_PROPOSAL.md](PHASE2_PROPOSAL.md), run 2026-11-20. A throwaway Tauri app (`spike/shell`, kept on a local
`spike-shell` branch, not merged and not pushed) that loads this repository's built page and runs each check by itself, reporting to
the terminal. Tauri 2.12.7 with `tauri-plugin-fs` 2.7.1, `-dialog` 2.8.4 and `-persisted-scope` 2.4.3; Rust 1.94.1;
`age-encryption` 0.3.1; macOS 26.7.2 on Apple silicon. **[V]** means run here; **[I]** means inferred.

## What it found

| The question | The answer |
| --- | --- |
| Rust | 1.94.1 was already installed through `rustup`. **[V]** |
| The page in a Tauri window | Yes. Built with plain `cargo`, the page (`dist/`) is embedded and served by the app at `tauri://localhost`, with no server and no network. The footer reads the page's version. **[V]** |
| Which webview | WebKit (`AppleWebKit/605.1.15`), so WKWebView. **[V]** |
| A PDF in the real webview | The invented `form.pdf` gives "13 blanks found" in about a second, with every label as on the web page. So pdf.js's worker and the text reader's worker and WebAssembly load from `tauri://`. Forms are remembered across restarts, in the app's own WebKit storage. **[V]** |
| A service worker | It does not register: WebKit wants an http or https address for one. The page carries on without it, as the plan meant: none in the shell. **[V]** |
| A folder, kept after a restart | Writing in a folder is refused until it is granted. Once granted it works, and after a restart it still works with no new grant: `persisted-scope` saved it in the app's data folder (`.persisted-scope`) and read it back. **[V]** |
| The same for a folder picked in the dialog | The dialog plugin grants a picked folder with the same call the spike used (`allow_directory` on the window's file scope, in its `commands.rs`). **[V]** from its source; a real click was not run. |
| `age` in the webview | 16 MB sealed with a passphrase in 564 ms and opened in 526 ms (scrypt at its default work factor). With a key pair: 69 ms and 72 ms. A 64 MB stream sealed and opened again in 566 ms. The 16 MB came back byte for byte; the stream's bytes were sampled, after `age` had checked each piece. **[V]** |
| `age` against the stock `age` tool | Not run: the tool is on hold. |
| 2 GB through the shell (optimised build) | See below. **[V]** |

## The 2 GB stream

| Through the shell | 2 GB took | Speed |
| --- | --- | --- |
| Written with `FileHandle.write`, 8 MB at a time | 135 s | 15 MB/s |
| Written with `writeFile` and `{ append: true }`, 8 MB at a time | 1.0 s | 1,973 MB/s |
| Read back with `FileHandle.read` | 0.7 s | 2,821 MB/s |
| Read again and sealed with `age` in the webview | 9.1 s | 224 MB/s |
| The backup's loop: sealed with `age` as it is made, written with `writeFile` appends | 9.8 s | 208 MB/s |
| The restore's loop: read back and opened with `age`, which checks every piece | 9.2 s | 223 MB/s |

`FileHandle.write` sends its bytes inside JSON (`{ rid, data }`), and the Rust side reads them back as a list of
numbers. `writeFile` takes them as the request's raw body. **[V]** in the plugin's code.

Memory during the two loops, sampled from outside every half second (`watch-memory.mjs`): at most 350 MB in the
page's WebKit process and 126 MB in the program, while 2 GB went through. **[V]**; a peak shorter than half a second
could be missed.

So the backup loop can stay in JavaScript, as proposed, if it writes with `writeFile` appends, never
`FileHandle.write`. `age` in JavaScript, at a little over 200 MB/s, sets the pace. The Rust fallback is needed neither
for speed nor for memory. **[I]** for archives much larger than 2 GB, and the write speed may include the operating
system's cache.

## Not checked

- The handwriting reader's ONNX WebAssembly in the shell (it needs a 64 MB model download).
- A real folder pick, by a click in the dialog.
- `age` against the stock tool (on hold).
- A bundled, unsigned `.app` opened from the Finder; only the bare program was run, from the terminal.
- A strict content-security policy; the spike ran with none.
- Archives much larger than 2 GB.

## What it changed on this Mac

- `~/.cargo` grew from 11 MB to 674 MB: cargo's downloads.
- Three of the app's own folders: `~/Library/Application Support/io.github.swixixle.formfiller.spike` (the saved
  scope), `~/Library/WebKit/form-filler-shell-spike` and `~/Library/Caches/form-filler-shell-spike`. All under 1 MB.
- A 2 GB file was made three times, in the session's scratch folder, and deleted each time. Checked afterwards.
- The build (2.9 GB) is in the session's scratch folder. Nothing else was installed.

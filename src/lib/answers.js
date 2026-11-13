// Turning loose answers into one answer per blank, by a few plain rules:
//
//   - A period ends an answer and moves to the next blank ("Jane Roe. 11/13/2026. Respiratory.").
//   - So does a new line, and a blank line between lines is the same single step.
//   - A lone dash ("-") is an answer that leaves its blank empty. So do extra periods: ". ." or ".." skips a blank.
//   - A number at the start ("4) Night", "4: Night") puts that answer in blank 4 and carries on from there. ("4. Night"
//     is answer "4" then "Night": the period still moves on.) "4:30" is a time, not a blank number.
//   - A period inside a number (98.6, 7.38), after an initial (J. Smith), after a common short title (Dr. Mr. Mrs.
//     Ms. St. Jr. Sr. vs. etc.), in a.m. or p.m., or with no space after it (jane@example.org, v1.2) is part of the
//     answer. Any other period moves on: so "Jane Roe.11/13/2026", with no space, is one answer.
//   - For a checkbox, "x", "yes", "y", "check", "checked" or "✓" ticks it; anything else leaves it empty.
export const TICK = /^(?:x|yes|y|check(?:ed)?|✓|✔|☑|tick)$/i;

export function splitAnswers(text) {
  // Periods that belong to the answer are set aside first, so only the separating ones are left.
  const KEEP = '\u0000';
  let source = String(text || '').replace(/\r\n?/g, '\n')
    .replace(/(\d)\.(?=\d)/g, '$1' + KEEP)                             // 7.38
    .replace(/(^|[\s(])([A-Z])\.(?=\s*[A-Z](?:[a-z]|\.))/g, '$1$2' + KEEP);  // J. Smith, J.R. Smith
  source = source.replace(/(^|\s)(dr|mr|mrs|ms|st|jr|sr|vs|etc|apt|ave|dept)\./gi, '$1$2' + KEEP)   // Dr.
    .replace(/\b([ap])\.m\./gi, '$1' + KEEP + 'm' + KEEP)                                          // 4 p.m.
    .replace(/([^\s.])\.(?=[^\s.])/g, '$1' + KEEP);                                                // jane@example.org, v1.2
  const out = [], parts = source.split(/([.\n])/);
  let periods = 0, started = false;
  for (const part of parts) {
    if (part === '.') { periods++; continue; }
    if (part === '\n') continue;
    if (!part.trim()) continue;
    // Between two answers one period is the step itself; each further period is an empty blank. Before the first
    // answer every period is an empty blank.
    for (let skip = started ? periods - 1 : periods; skip > 0; skip--) out.push({ text: '', at: null });
    periods = 0; started = true;
    const answer = part.replace(new RegExp(KEEP, 'g'), '.').trim(), numbered = answer.match(/^(\d{1,3})(?:\)|:\s)\s*(.*)$/s);
    const value = numbered ? numbered[2].trim() : answer;
    out.push({ text: /^[-–—]$/.test(value) ? '' : value, at: numbered ? Number(numbered[1]) : null });
  }
  return out;
}

// Places answers into blanks: in order, except a numbered one jumps to its blank. Returns one string per blank (or
// true/false for a checkbox) and what was left over, never silently dropped.
// `skip`: blank indexes that are already filled some other way (your saved details, today's date). Answers in order
// pass over them, so you type only what is missing; a numbered answer ("3) …") still goes exactly where it says.
export function placeAnswers(blanks, text, { skip } = {}) {
  const values = blanks.map(blank => blank.kind === 'check' ? false : ''), extra = [], passed = skip instanceof Set ? skip : new Set(skip || []);
  let at = 0;
  for (const answer of splitAnswers(text)) {
    if (answer.at) at = answer.at - 1;
    else while (passed.has(at) && at < blanks.length) at++;
    if (at >= blanks.length) { if (answer.text) extra.push(answer.text); at++; continue; }
    values[at] = blanks[at].kind === 'check' ? TICK.test(answer.text.trim()) : answer.text;
    at++;
  }
  return { values, extra };
}

// Curated checkbox-caption rows: invented captions and layouts, no person. Each entry of ROWS is [name, input,
// expected], where `expected` is what labelsOf(input) in labels.test.js gives: every blank's label, or { unsure } for a
// checkbox whose caption cannot be told. Each expected value was read by hand: none pins a label from another box.
//
// Inputs use the same row() helper as labels.test.js (UNIT 26, CHAR 14, SIDE 28; a number is a space in pixels, '[]' a
// checkbox, '___' a line to write on, a string a word, an object a word placed by hand { text, dx, confidence,
// symbols }). Rows that need words on another line (headings, wrapped captions) or a turned photo add them with the
// small helpers after it (at, plus, both, turn, headed).
//
// LIMITS (at the end) are clear captions the rule leaves unclear (a cost, never a wrong label), with what a reader
// would call each. They fail today and run as "todo".
export const UNIT = 26, CHAR = 14, SIDE = 28;
export function row(...tokens) {
  const blanks = [], words = [], y = 100;
  let x = 100;
  for (const token of tokens) {
    if (typeof token === 'number') { x += token; continue; }
    if (token === '[]') { blanks.push({ kind: 'check', x0: x + 5, y0: y + 2, x1: x + SIDE - 5, y1: y + SIDE - 2 }); x += SIDE; continue; }
    if (token === '___') { blanks.push({ kind: 'line', x0: x, y0: y + SIDE - 72, x1: x + 300, y1: y + SIDE - 2 }); x += 300; continue; }
    if (typeof token === 'object') { words.push({ text: token.text, confidence: token.confidence ?? 90, bbox: { x0: x + token.dx, y0: y, x1: x + token.dx + token.text.length * CHAR, y1: y + UNIT }, ...(token.symbols ? { symbols: token.symbols(x + token.dx, y) } : {}) }); continue; }
    words.push({ text: token, confidence: 90, bbox: { x0: x, y0: y, x1: x + token.length * CHAR, y1: y + UNIT } }); x += token.length * CHAR;
  }
  return { blanks, words };
}
// Letters for a word laid at x: each CHAR wide, with the given confidences (as in labels.test.js).
export const letters = (text, confidences) => (x, y) => [...text].map((char, at) => ({ text: char, confidence: confidences[at] ?? 95, bbox: { x0: x + at * CHAR, y0: y, x1: x + (at + 1) * CHAR, y1: y + UNIT } }));

// Words on another text line: `text` from x, its top at y, h tall (UNIT unless given), `char` px a letter, 10 px apart.
const at = (text, x, y, { h = UNIT, char = CHAR } = {}) => text.split(' ').map(word => { const out = { text: word, confidence: 90, bbox: { x0: x, y0: y, x1: x + word.length * char, y1: y + h } }; x += word.length * char + 10; return out; });
// An input with more words; two inputs as one page.
const plus = (input, ...more) => ({ blanks: input.blanks, words: [...input.words, ...more.flat()] });
const both = (a, b) => ({ blanks: [...a.blanks, ...b.blanks], words: [...a.words, ...b.words] });
const down = (input, dy, dx = 0) => ({ blanks: input.blanks.map(b => ({ ...b, x0: b.x0 + dx, x1: b.x1 + dx, y0: b.y0 + dy, y1: b.y1 + dy })),
  words: input.words.map(w => ({ ...w, bbox: { x0: w.bbox.x0 + dx, x1: w.bbox.x1 + dx, y0: w.bbox.y0 + dy, y1: w.bbox.y1 + dy } })) });
// The page turned a little, as on a phone photo: every point moved down by (x - 100) * tan(degrees).
const turn = (input, degrees) => {
  const k = Math.tan(degrees * Math.PI / 180), d = x => Math.round((x - 100) * k);
  return { blanks: input.blanks.map(b => ({ ...b, y0: b.y0 + d(b.x0), y1: b.y1 + d(b.x0) })), words: input.words.map(w => ({ ...w, bbox: { ...w.bbox, y0: w.bbox.y0 + d(w.bbox.x0), y1: w.bbox.y1 + d(w.bbox.x0) } })) };
};
// Boxes on one line (y 142-166) with a heading centred over each (y 100-126): box k's middle at middles[k], its heading's
// middle `off` px to the right of it; `beside`: a word (an answer code) 4 px after each box.
const headed = (heads, middles, { off = 0, beside = null } = {}) => {
  const blanks = [], words = [];
  heads.forEach((head, k) => {
    const middle = middles[k], x = middle - SIDE / 2, width = head.length * CHAR;
    blanks.push({ kind: 'check', x0: x + 5, y0: 142, x1: x + SIDE - 5, y1: 166 });
    words.push({ text: head, confidence: 90, bbox: { x0: middle + off - width / 2, y0: 100, x1: middle + off + width / 2, y1: 126 } });
    if (beside) words.push({ text: beside[k], confidence: 90, bbox: { x0: x + SIDE + 4, y0: 140, x1: x + SIDE + 4 + beside[k].length * CHAR, y1: 166 } });
  });
  return { blanks, words };
};
const words = text => text.split(' ').flatMap((word, i) => i ? [10, word] : [word]);

export const ROWS = [
  // A caption beside its box, on either side; pairs and lists.
  ['a caption on the right, after a question', row('Parking?', 40, '[]', 12, 'Yes'), ['Yes']],
  ['a caption on the left, after a question', row('Parking?', 40, 'Yes', 12, '[]'), ['Yes']],
  ['a pair, captions on the right, after a prompt with ":"', row('Contact:', 40, '[]', 12, 'Email', 50, '[]', 12, 'Phone'), ['Email', 'Phone']],
  ['a pair, captions on the left, after a prompt with ":"', row('Contact:', 40, 'Email', 12, '[]', 50, 'Phone', 12, '[]'), ['Email', 'Phone']],
  ['three right captions of two words, ending alike', row('[]', 12, 'Day', 10, 'shift', 40, '[]', 12, 'Night', 10, 'shift', 40, '[]', 12, 'Late', 10, 'shift'), ['Day shift', 'Night shift', 'Late shift']],
  ['three left captions, evenly spaced', row('Red', 16, '[]', 16, 'Blue', 16, '[]', 16, 'Green', 16, '[]'), ['Red', 'Blue', 'Green']],
  // Ties: never a pick.
  ['a tie: one word as near both boxes', row('[]', 24, 'Either', 24, '[]'), [{ unsure: ['Either'] }, { unsure: ['Either'] }]],
  ['a tie: a lone box with words as near on both sides', row('Pets', 16, '[]', 16, 'Dogs', 10, 'only'), [{ unsure: ['Pets', 'Dogs only'] }]],
  ['a tie: a word, then a pair, evenly spaced (the captions may be shifted by one)', row('Vegetarian', 18, '[]', 18, 'Yes', 18, '[]', 18, 'No'), [{ unsure: ['Vegetarian', 'Yes'] }, { unsure: ['Yes', 'No'] }]],
  // List numbers and letters.
  ['a list number before the box', row('2.', 14, '[]', 12, 'I', 10, 'accept'), ['I accept']],
  ['options numbered after their boxes', row('[]', 12, '1.', 10, 'Single', 40, '[]', 12, '2.', 10, 'Married'), [{ unsure: ['Single', '1. Single'] }, { unsure: ['Married', '2. Married'] }]],
  ['a list letter before a lone box', row('a)', 12, '[]', 12, 'Walk'), ['Walk']],
  // The end caption (no box beyond it): run-ons and the usual last options.
  ['a usual last option: "Prefer not to say"', row('[]', 12, 'Male', 40, '[]', 12, 'Female', 40, '[]', 12, 'Prefer', 10, 'not', 10, 'to', 10, 'say'), ['Male', 'Female', 'Prefer not to say']],
  ['an end caption that cannot be cut: "None of the above"', row('[]', 12, 'Cough', 40, '[]', 12, 'Fever', 40, '[]', 12, 'None', 10, 'of', 10, 'the', 10, 'above'), ['Cough', 'Fever', 'None of the above']],
  ['"Under 18" and "18 or over": a number among a caption\'s words may be a code or a price, unsure', row('[]', 12, 'Under', 10, '18', 40, '[]', 12, '18', 10, 'or', 10, 'over'), [{ unsure: ['Under', 'Under 18'] }, { unsure: ['or over', '18 or over'] }]],
  ['an end caption longer than the others may run on into a note', row('[]', 12, 'Yes', 40, '[]', 12, 'No', 10, 'thanks'), ['Yes', { unsure: ['No', 'No thanks'] }]],
  ['an end caption with a capitalised later word (another phrase may begin there)', row('[]', 12, 'Most', 10, 'days', 40, '[]', 12, 'Some', 10, 'days', 40, '[]', 12, 'Never', 10, 'Section', 10, 'B'), ['Most days', 'Some days', { unsure: ['Never Section', 'Never Section B'] }]],
  ['scale ends are usual last options: "Strongly disagree"', row('[]', 12, 'Agree', 40, '[]', 12, 'Disagree', 40, '[]', 12, 'Strongly', 10, 'disagree'), ['Agree', 'Disagree', 'Strongly disagree']],
  // Notes after a sign, and what is no note.
  ['a note in brackets after a caption', row('[]', 12, 'Yes', 10, '(see', 10, 'note', 10, '4)', 40, '[]', 12, 'No'), [{ unsure: ['Yes', 'Yes (see note 4)'] }, 'No']],
  ['a routing note after a dash', row('[]', 12, 'Yes', 10, '–', 10, 'go', 10, 'to', 10, 'Q8', 40, '[]', 12, 'No'), [{ unsure: ['Yes', 'Yes – go to Q8'] }, 'No']],
  ['a dash between two numbers is a range, no note', row('[]', 12, '18', 10, '–', 10, '24', 40, '[]', 12, '25', 10, '–', 10, '34'), ['18 – 24', { unsure: ['25', '25 – 34'] }]],
  ['a bracket holding a word ending is no note', row('[]', 12, 'Soltero(a)', 40, '[]', 12, 'Casado(a)'), ['Soltero(a)', 'Casado(a)']],
  ['the answer of a lone box after a question goes on after a comma', row('Reminders?', 14, '[]', 12, 'Yes,', 10, 'by', 10, 'text'), [{ unsure: ['Yes', 'Yes, by text'] }]],
  ['after a comma, a routing note is no answer', row('Reminders?', 14, '[]', 12, 'Yes,', 10, 'see', 10, 'overleaf'), [{ unsure: ['Yes', 'Yes, see overleaf'] }]],
  ['a note after a comma, between two boxes', row('[]', 12, 'Yes,', 10, 'please', 10, 'call', 40, '[]', 12, 'No'), [{ unsure: ['Yes', 'Yes, please call'] }, 'No']],
  ['a footnote mark raised after a caption', plus(row('[]', 12, 'Retired', 50, '[]', 12, 'Working'), [{ text: '3', confidence: 90, bbox: { x0: 100 + SIDE + 12 + 7 * CHAR + 1, y0: 98, x1: 100 + SIDE + 12 + 7 * CHAR + 9, y1: 113 } }]), [{ unsure: ['Retired', 'Retired 3'] }, 'Working']],
  ['a note in smaller print after a caption', plus(row('[]', 12, 'Yes', 200, '[]', 12, 'No'), at('Details below', 100 + SIDE + 12 + 3 * CHAR + 8, 108, { h: 17, char: 10 })), [{ unsure: ['Yes', 'Yes Details below'] }, 'No']],
  // Routing after a plain space, and at the margin after a dot leader.
  ['routing after a plain space', row('[]', 12, 'Yes', 10, 'go', 10, 'to', 10, 'Q6', 40, '[]', 12, 'No'), [{ unsure: ['Yes', 'Yes go to Q6'] }, 'No']],
  ['a dot leader ends a right caption (the routing is the margin\'s)', row('[]', 12, 'Yes', 10, '..........', 10, 'go', 10, 'to', 10, 'Q6'), [{ unsure: ['Yes', 'Yes go to Q6'] }]],
  ['a question number after the end caption', row('[]', 12, 'Yes', 40, '[]', 12, 'No', 10, 'Q7'), ['Yes', { unsure: ['No', 'No Q7'] }]],
  // Answer codes and option codes.
  ['answer codes before the boxes, counting up', row('1', 2, '[]', 10, 'Bus', 10, '2', 2, '[]', 10, 'Car', 10, '3', 2, '[]', 10, 'Walk'), [{ unsure: ['1'] }, { unsure: ['Bus 2'] }, { unsure: ['Car 3', 'Walk'] }]],
  ['answer codes before the boxes, counting down', row('3', 2, '[]', 10, 'Often', 10, '2', 2, '[]', 10, 'Rarely', 10, '1', 2, '[]', 10, 'Never'), [{ unsure: ['3'] }, { unsure: ['Often 2'] }, { unsure: ['Rarely 1', 'Never'] }]],
  ['letter codes before the boxes', row('a)', 4, '[]', 10, 'Tea', 12, 'b)', 4, '[]', 10, 'Coffee', 12, 'c)', 4, '[]', 10, 'Water'), [{ unsure: ['Tea', 'Tea b)'] }, { unsure: ['b)', 'Coffee'] }, { unsure: ['c)', 'Water'] }]],
  ['answer codes on a photo turned 3 degrees', turn(row('1', 2, '[]', 10, 'Yes', 10, '2', 2, '[]', 10, 'No', 10, '3', 2, '[]', 10, 'Not', 10, 'sure'), 3), [{ unsure: ['1'] }, { unsure: ['Yes 2'] }, { unsure: ['No 3', 'Not sure'] }]],
  ['an option code and colon after the box', row('[]', 12, 'Plan', 10, 'A:', 10, 'Basic', 40, '[]', 12, 'Plan', 10, 'B:', 10, 'Plus'), [{ unsure: ['Plan A'] }, { unsure: ['Basic', 'Plan B'] }]],
  // Prices.
  ['item, dot leader, price, box, twice on a line', row('Adult', 10, '..........', 10, '$12', 10, '[]', 50, 'Child', 10, '..........', 10, '$6', 10, '[]'), [{ unsure: ['Adult', 'Adult $12'] }, { unsure: ['Child', 'Child $6'] }]],
  ['a price after a dash on the right', row('[]', 12, 'Adult', 10, '–', 10, '$25', 40, '[]', 12, 'Child', 10, '–', 10, '$10'), [{ unsure: ['Adult', 'Adult – $25'] }, { unsure: ['Child', 'Child – $10'] }]],
  ['a lone box between its caption and a price', row('Express', 10, 'delivery', 14, '[]', 14, '$9.95'), [{ unsure: ['Express delivery', '$9.95'] }]],
  // Row labels and runs of boxes.
  ['runs of two boxes after row labels: a row label is a reading only', row('Fever', 30, '[]', 40, '[]', 80, 'Cough', 30, '[]', 40, '[]'), [{ unsure: ['Fever'] }, '', { unsure: ['Cough'] }, '']],
  ['a run of two boxes, each clearly nearer its own words', row('I', 10, 'agree', 10, 'to', 10, 'the', 10, 'rules', 14, '[]', 80, '[]', 14, 'Send', 10, 'me', 10, 'news'), ['I agree to the rules', 'Send me news']],
  // Headings over the boxes.
  ['captions printed above the boxes', headed(['Sat', 'Sun'], [200, 320]), ['Sat', 'Sun']],
  ['headings above and an answer code beside each box: unsure', headed(['Good', 'Fair', 'Poor'], [200, 320, 440], { beside: ['1', '2', '3'] }), [{ unsure: ['1', 'Good'] }, { unsure: ['2', 'Fair'] }, { unsure: ['3', 'Poor'] }]],
  // Scales.
  ['a scale: words at its ends, numbers beside the boxes', row('Poor', 20, '1', 4, '[]', 30, '2', 4, '[]', 30, '3', 4, '[]', 20, 'Good'), [{ unsure: ['1'] }, { unsure: ['2'] }, { unsure: ['3', 'Good'] }]],
  // Wrapped captions.
  ['a wrapped caption, its second line under the caption', plus(row('[]', 12, ...words('I would like to hear about the summer')), at('fair and other events.', 140, 134)), [{ unsure: ['I would like to hear about the summer', 'I would like to hear about the summer fair and other events.'] }]],
  ['a wrapped caption, its second line at the margin under the box', plus(row('[]', 12, ...words('I consent to photographs being taken at club')), at('events and activities.', 100, 134)), [{ unsure: ['I consent to photographs being taken at club', 'I consent to photographs being taken at club events and activities.'] }]],
  ['a caption broken at a joining word is read on into the next row', plus(row('[]', 12, ...words('Use my details for')), at('research purposes only', 140, 134)), [{ unsure: ['Use my details for', 'Use my details for research purposes only'] }]],
  // Lone boxes.
  ['a lone box, its caption on the left', row('I', 10, 'agree', 10, 'to', 10, 'the', 10, 'rules', 14, '[]'), ['I agree to the rules']],
  ['a lone box: a far word on its right is no caption', row('[]', 12, 'Gift', 10, 'aid', 300, 'Office'), ['Gift aid']],
  ['a field after the last caption', row('[]', 12, 'Married', 40, '[]', 12, 'Single', 40, "Partner's", 10, 'name:', 12, '___'), ['Married', 'Single', "Partner's name"]],
  // Small letters.
  ['captions all in small letters', row('[]', 12, 'yes', 40, '[]', 12, 'no'), ['yes', 'no']],
  ['a lone caption starting with a small letter (its first word may be lost)', row('[]', 12, 'agree', 10, 'to', 10, 'terms'), [{ unsure: ['agree to terms'] }]],
  // Reader doubt.
  ['a word the reader was unsure of is no caption, and is not passed over', row('[]', 12, { text: 'Smoker', dx: 0, confidence: 30 }, 6 * CHAR + 40, '[]', 12, 'No'), ['', 'No']],
  ['"1" read for "I": both readings', row('[]', 12, '1', 10, 'consent'), [{ unsure: ['1 consent', 'I consent'] }]],
  ['the square read into the caption: "[]Yes"', row('[]', { text: '[]Yes', dx: -SIDE }, 14 + 3 * CHAR, 50, '[]', 14, 'No'), ['Yes', 'No']],
  ['a caption run into the square, sure letter by letter: "[_]Text"', row('Contact:', 14, '[]', { text: '[_]Text', dx: -SIDE, confidence: 28, symbols: letters('[_]Text', [97, 60, 96, 95, 96, 95, 96]) }, 14 + 4 * CHAR, 40, '[]', 14, 'Email'), ['Text', 'Email']],
  ['right captions on a photo turned -4 degrees (words run on to the next box\'s height)', turn(row('[]', 12, 'Day', 10, 'shift', 10, 'only', 40, '[]', 12, 'Night', 10, 'shift', 10, 'only'), -4), [{ unsure: ['Day shift'] }, { unsure: ['only', 'Night shift only'] }]],
  // Bilingual captions and units.
  ['bilingual captions joined by a slash with no spaces', row('[]', 12, 'Yes/Oui', 40, '[]', 12, 'No/Non'), ['Yes/Oui', 'No/Non']],
  ['bilingual captions with a spaced slash: unsure', row('[]', 12, 'Yes', 10, '/', 10, 'Oui', 40, '[]', 12, 'No', 10, '/', 10, 'Non'), [{ unsure: ['Yes', 'Yes / Oui'] }, { unsure: ['No', 'No / Non'] }]],
  ['units with numbers: a number among a caption\'s words may be a code or a price, unsure', row('[]', 12, '500', 10, 'ml', 40, '[]', 12, '1', 10, 'litre', 40, '[]', 12, '2', 10, 'litres'), [{ unsure: ['ml', '500 ml'] }, { unsure: ['litre', '1 litre'] }, { unsure: ['litres', '2 litres'] }]],
  // Layouts on which an earlier draft of the rule gave a wrong label: their boxes are left unclear.
  ['a question, a dot leader, then options that are numbers: answer codes may stand there, all unsure', row('Number', 10, 'of', 10, 'guests', 10, '..........', 10, '1', 10, '[]', 30, '2', 10, '[]', 30, '3', 10, '[]'), [{ unsure: ['Number of guests 1'] }, { unsure: ['2'] }, { unsure: ['3'] }]],
  ['caption, answer code, box, then a note: the captions may be shifted by one, unsure', row('Yes', 40, '1', 4, '[]', 40, 'No', 40, '2', 4, '[]', 40, '(tick', 10, 'one)'), [{ unsure: ['1', 'No'] }, { unsure: ['2', '(tick one)'] }]],
  ['answer codes 1, 2, 9 before the boxes (not counting by one): all unsure', row('1', 2, '[]', 10, 'Yes', 10, '2', 2, '[]', 10, 'No', 10, '9', 2, '[]', 10, "Don't", 10, 'know'), [{ unsure: ['1'] }, { unsure: ['Yes 2'] }, { unsure: ['No 9', "Don't know"] }]],
  ['a question number close before the first answer code: all unsure', row('Q4', 10, '1', 2, '[]', 10, 'Yes', 10, '2', 2, '[]', 10, 'No'), [{ unsure: ['Q4 1'] }, { unsure: ['Yes 2', 'No'] }]],
  ['headings centred over cells "[ ] n" (the box 9 px off its heading\'s middle): each box unsure', headed(['Good', 'Fair', 'Poor'], [200, 320, 440], { off: 9, beside: ['1', '2', '3'] }), [{ unsure: ['1', 'Good'] }, { unsure: ['2', 'Fair'] }, { unsure: ['3', 'Poor'] }]],
  ['a list number before the box, the caption wrapping to the margin: unsure, never its first line only', plus(row('1.', 14, '[]', 10, ...words('I consent to my child being photographed during school')), at('activities and events.', 100, 134)), [{ unsure: ['I consent to my child being photographed during school', 'I consent to my child being photographed during school activities and events.'] }]],
  ['a note after a plain space with no instruction word ("Yes give details below"): more words than the others, unsure', row('[]', 12, 'Yes', 10, 'give', 10, 'details', 10, 'below', 40, '[]', 12, 'No'), [{ unsure: ['Yes', 'Yes give details below'] }, 'No']],
  // From the last check: two pairs on one line, a wrap under the first column, and lone boxes after their questions.
  ['two questions on one line, each with its own pair', row('Smoke?', 20, '[]', 12, 'Yes', 40, '[]', 12, 'No', 40, 'Pets?', 20, '[]', 12, 'Yes', 40, '[]', 12, 'No'), ['Yes', 'No', 'Yes', 'No']],
  ['two columns, the first caption wrapping under itself: unsure, never its first line only', plus(row('[]', 12, ...words('Sports and outdoor'), 60, '[]', 12, ...words('Music and singing')), at('activities', 140, 134)), [{ unsure: ['Sports and outdoor', 'Sports and outdoor activities'] }, { unsure: ['Music and', 'Music and singing'] }]],
  ['a lone box after its question: the question', row('Do', 10, 'you', 10, 'need', 10, 'a', 10, 'ramp?', 14, '[]'), ['Do you need a ramp?']],
  ['a lone box after its question, another field beyond reach on its line', row('Member?', 14, '[]', 140, 'Number:', 10, '___'), ['Member?', 'Number']],
  // A question, its lone box, then words on its right that are another field's prompt or a note: unclear, never the prompt.
  ['a question, its lone box, then another field\'s one-word prompt: unclear, never the prompt', row('Member?', 14, '[]', 30, 'Number:', 10, '___'), [{ unsure: ['Member?', 'Number'] }, 'Number']],
  ['a question, its lone box, then a one-word note in brackets: unclear', row('Smoker?', 14, '[]', 12, '(optional)'), [{ unsure: ['Smoker?', '(optional)'] }]],
];

// Clear captions the rule leaves unclear (a cost, never a wrong label), with what each should give.
export const LIMITS = [
  ['options numbered after their boxes', row('[]', 12, '1.', 10, 'Single', 40, '[]', 12, '2.', 10, 'Married'), ['1. Single', '2. Married']],
  ['an end caption that cannot be cut: "18 or over"', row('[]', 12, 'Under', 10, '18', 40, '[]', 12, '18', 10, 'or', 10, 'over'), ['Under 18', '18 or over']],
  ['a dash between two numbers is a range, no note', row('[]', 12, '18', 10, '–', 10, '24', 40, '[]', 12, '25', 10, '–', 10, '34'), ['18 – 24', '25 – 34']],
  ['the answer of a lone box after a question goes on after a comma', row('Reminders?', 14, '[]', 12, 'Yes,', 10, 'by', 10, 'text'), ['Yes, by text']],
  ['a dot leader ends a right caption (the routing is the margin\'s)', row('[]', 12, 'Yes', 10, '..........', 10, 'go', 10, 'to', 10, 'Q6'), ['Yes']],
  ['answer codes before the boxes, counting up', row('1', 2, '[]', 10, 'Bus', 10, '2', 2, '[]', 10, 'Car', 10, '3', 2, '[]', 10, 'Walk'), ['Bus', 'Car', 'Walk']],
  ['answer codes before the boxes, counting down', row('3', 2, '[]', 10, 'Often', 10, '2', 2, '[]', 10, 'Rarely', 10, '1', 2, '[]', 10, 'Never'), ['Often', 'Rarely', 'Never']],
  ['letter codes before the boxes', row('a)', 4, '[]', 10, 'Tea', 12, 'b)', 4, '[]', 10, 'Coffee', 12, 'c)', 4, '[]', 10, 'Water'), ['Tea', 'Coffee', 'Water']],
  ['answer codes on a photo turned 3 degrees', turn(row('1', 2, '[]', 10, 'Yes', 10, '2', 2, '[]', 10, 'No', 10, '3', 2, '[]', 10, 'Not', 10, 'sure'), 3), ['Yes', 'No', 'Not sure']],
  ['an option code and colon after the box', row('[]', 12, 'Plan', 10, 'A:', 10, 'Basic', 40, '[]', 12, 'Plan', 10, 'B:', 10, 'Plus'), ['Plan A: Basic', 'Plan B: Plus']],
  ['item, dot leader, price, box, twice on a line', row('Adult', 10, '..........', 10, '$12', 10, '[]', 50, 'Child', 10, '..........', 10, '$6', 10, '[]'), ['Adult', 'Child']],
  ['a scale: words at its ends, numbers beside the boxes', row('Poor', 20, '1', 4, '[]', 30, '2', 4, '[]', 30, '3', 4, '[]', 20, 'Good'), ['1', '2', '3']],
  ['a caption broken at a joining word is read on into the next row', plus(row('[]', 12, ...words('Use my details for')), at('research purposes only', 140, 134)), ['Use my details for research purposes only']],
  ['units with numbers ("1" is a number here)', row('[]', 12, '500', 10, 'ml', 40, '[]', 12, '1', 10, 'litre', 40, '[]', 12, '2', 10, 'litres'), ['500 ml', '1 litre', '2 litres']],
  // From the last check. "WRONG today": the rule gives these boxes words that are not their caption.
  ['a question, its lone box, then another field\'s one-word prompt', row('Member?', 14, '[]', 30, 'Number:', 10, '___'), ['Member?', 'Number']],
  ['a question, its lone box, then a one-word note in brackets', row('Smoker?', 14, '[]', 12, '(optional)'), ['Smoker?']],
  ['WRONG today: a note after a plain space whose words are not on the instruction list ("answer 5a")', row('[]', 12, 'Employed', 10, 'answer', 10, '5a', 40, '[]', 12, 'Self-employed', 10, 'answer', 10, '5b'), ['Employed', 'Self-employed']],
  ['WRONG today: a lone box, a note after a plain space ("call ahead")', row('[]', 12, 'Wheelchair', 10, 'user', 10, 'call', 10, 'ahead'), ['Wheelchair user']],
  ['WRONG today: a note after "yes" and "no" in another language', row('[]', 12, 'Oui', 10, 'précisez', 40, '[]', 12, 'Non', 10, 'précisez'), ['Oui', 'Non']],
  ['WRONG today: a page reference after each caption', row('[]', 12, 'Employed', 10, 'p.4', 40, '[]', 12, 'Retired', 10, 'p.5', 40, '[]', 12, 'Student', 10, 'p.6'), ['Employed', 'Retired', 'Student']],
  ['WRONG today: prices the price pattern misses ("12pp")', row('[]', 12, 'Adult', 10, '12pp', 40, '[]', 12, 'Child', 10, '6pp', 40, '[]', 12, 'Family', 10, '30pp'), ['Adult', 'Child', 'Family']],
  ['WRONG today: prices the price pattern misses ("Rs.500")', row('[]', 12, 'Single', 10, 'Rs.500', 40, '[]', 12, 'Couple', 10, 'Rs.800', 40, '[]', 12, 'Family', 10, 'Rs.1000'), ['Single', 'Couple', 'Family']],
  ['WRONG today: two-letter answer codes after the captions', row('[]', 12, 'Daily', 10, 'DY', 40, '[]', 12, 'Weekly', 10, 'WK', 40, '[]', 12, 'Monthly', 10, 'MO'), ['Daily', 'Weekly', 'Monthly']],
  ['WRONG today: two columns numbered in the margin, the first caption wrapping back to the margin', plus(row('1.', 14, '[]', 12, ...words('Sports and outdoor'), 60, '[]', 12, ...words('Music and singing')), at('activities', 100, 134)), ['Sports and outdoor activities', 'Music and singing']],
  ['WRONG today: options typed as running text, the broken caption going on indented past the first box', both(row('[]', 10, 'Radio', 20, '[]', 10, 'Friend', 20, '[]', 10, 'Social'), down(row('media', 20, '[]', 10, 'Other'), 34, 20)), ['Radio', 'Friend', 'Social media', 'Other']],
  ['two columns, the first caption wrapping under itself', plus(row('[]', 12, ...words('Sports and outdoor'), 60, '[]', 12, ...words('Music and singing')), at('activities', 140, 134)), ['Sports and outdoor activities', 'Music and singing']],
];

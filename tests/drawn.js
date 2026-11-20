// Pages drawn in code for the blank finder, so a test needs no picture file: block capitals from a 5 x 7 grid and
// rules as filled rectangles, at the page's working width (1700 x 2200 px, a Letter page; about 2.8 px to the point).
// The words are invented.
export const W = 1700, H = 2200;
const GLYPHS = {
  A: '.###.#...##...######...##...##...#', B: '####.#...##...#####.#...##...#####.', D: '####.#...##...##...##...##...#####.',
  E: '######....#....####.#....#....#####', G: '.###.#...##....#.####...##...#.###.', H: '#...##...##...#######...##...##...#',
  I: '.###...#....#....#....#....#...###.', K: '#...##..#.#.#..##...#.#..#..#.#...#', L: '#....#....#....#....#....#....#####',
  M: '#...###.###.#.##.#.##...##...##...#', N: '#...###..##.#.##..###...##...##...#', O: '.###.#...##...##...##...##...#.###.',
  R: '####.#...##...#####.#.#..#..#.#...#', S: '.#####....#.....###.....#....#####.', T: '#####..#....#....#....#....#....#..',
  V: '#...##...##...##...##...#.#.#...#..', W: '#...##...##...##.#.##.#.###.###...#', C: '.###.#...##....#....#....#...#.###.',
  P: '####.#...##...#####.#....#....#....', $: '..#...####.#.#..###...#.#.####...#.',
};
export function page() { return { gray: new Uint8Array(W * H).fill(255), width: W, height: H }; }
export function fill(p, x0, y0, x1, y1) { for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) p.gray.fill(0, y * W + Math.max(0, x0), y * W + Math.min(W, x1)); }
// A word in block capitals, its top left at (x, y), s px a grid square (3: letters 21 px tall, about 10 pt type).
// Returns the column after its last ink.
export function word(p, text, x, y, s = 3) {
  for (const ch of text) {
    if (ch === ' ') { x += 4 * s; continue; }
    const glyph = GLYPHS[ch];
    for (let at = 0; at < 35; at++) if (glyph[at] === '#') fill(p, x + (at % 5) * s, y + Math.floor(at / 5) * s, x + (at % 5 + 1) * s, y + (Math.floor(at / 5) + 1) * s);
    x += 6 * s;
  }
  return x - s;
}
// A table: its walls at xs and its rules at ys (px), 3 px thick; the inner walls stop `short` px short of each rule.
export function table(p, xs, ys, { short = 0 } = {}) {
  for (const y of ys) fill(p, xs[0], y, xs[xs.length - 1] + 3, y + 3);
  xs.forEach((x, index) => { const gap = index > 0 && index < xs.length - 1 ? short : 0;
    for (let row = 0; row + 1 < ys.length; row++) fill(p, x, ys[row] + 3 + gap, x + 3, ys[row + 1] - gap); });
}
// Words in a cell whose walls start at x and whose rules are at top and bottom: from the left with a 14 px margin
// (or ending 14 px before x with { right: true }), in the middle of the row. Returns where the words start and end.
export function inCell(p, text, x, top, bottom, { right = false } = {}) {
  const wide = text.length * 18 - 3, x0 = right ? x - 14 - wide : x + 3 + 14;
  return { x0, x1: word(p, text, x0, Math.round((top + 3 + bottom) / 2 - 10.5)) };
}

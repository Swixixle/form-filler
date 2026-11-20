// Form Filler as a library: everything the page does that needs no browser. Import it from another program:
//
//   import { readTemplate, placeAnswers, buildPdf } from 'form-filler';
//
// blanks.js needs the page's pixels (gray, one byte per pixel); the rest work on JSON and PDF bytes alone.
export { threshold, skewOf, rotate, findBlanks, findOptions, nameOptions, order, labelFor, labelBlanks, cleanWords } from './blanks.js';
export { headerCells, headerLabel, headerLabels, cropOf } from './headers.js';
export { TICK, splitAnswers, placeAnswers, numberedLines } from './answers.js';
export { readFields, readableName, pickOption, withFound } from './fields.js';
export { plain, fitSize, wrap, isSignature, buildPdf, joinPdfs } from './output.js';
export { KINDS, makeTemplate, readTemplate } from './templates.js';
export { DETAILS, detailFor, detailValue, isDate, isSignatureLabel, formatDate, autofill } from './profile.js';
export { parseCsv, matchColumns, columnIds, columnsNow, rowValues } from './merge.js';
export { segmentLines } from './handwriting.js';
export { HANDWRITING_MODELS } from './models.js';

// The handwriting readers the page can use, pinned to exact revisions on Hugging Face so the same files are fetched
// every time (checked 2026-11-13). Both are TrOCR (Microsoft's handwriting model) in Xenova's ONNX conversion, read
// one line at a time. Licence as the model cards state it on 2026-11-13: small, MIT (Xenova's card); base, none on
// Xenova's card, MIT on Microsoft's. The larger one is not known to read better: on the synthetic test page it misread
// the date that the small one read right (scripts/check-handwriting.mjs, 2026-11-13). Sizes are the quantized files, downloaded once and then kept by the browser.
export const HANDWRITING_MODELS = {
  small: { id: 'Xenova/trocr-small-handwritten', revision: '02bea33ca09a70e2e2d91140a7e6e1a729606a5b', megabytes: 64, title: 'Quick' },
  base: { id: 'Xenova/trocr-base-handwritten', revision: 'e301d1c4c4d4ece88f164518eb7aee07062eaca2', megabytes: 338, title: 'Larger' },
};

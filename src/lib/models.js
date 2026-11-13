// The handwriting readers the page can use, pinned to exact revisions on Hugging Face so the same files are fetched
// every time (checked 2026-11-13). Both are TrOCR (Microsoft's handwriting model, MIT licence) in Xenova's ONNX
// conversion, read one line at a time. Sizes are the quantized files, downloaded once and then kept by the browser.
export const HANDWRITING_MODELS = {
  small: { id: 'Xenova/trocr-small-handwritten', revision: '02bea33ca09a70e2e2d91140a7e6e1a729606a5b', megabytes: 64, title: 'Quick' },
  base: { id: 'Xenova/trocr-base-handwritten', revision: 'e301d1c4c4d4ece88f164518eb7aee07062eaca2', megabytes: 338, title: 'More accurate' },
};

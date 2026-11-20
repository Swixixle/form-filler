// The one SHA-256 helper, for the page, the library and the command line: the fingerprint of some bytes, or of text
// as UTF-8, written as 64 lowercase hex digits. It uses the browser's own crypto (WebCrypto), which Node has too, so
// the page, the Mac app and the command line all fingerprint a file the same way.
export const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');

export async function sha256(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return hex(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

export const ACTIVE_FREE85_RELEASE = "Release_2.11.1";
export const ACTIVE_FREE85_ROM_SHA256 = "5942f3fce34b437d1f060e513aa4982baf5b41e5bd2154531a22709d851eb0f0";

export async function sha256Hex(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("ROM identity requires a Uint8Array");
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 is not available in this browser");
  }

  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function isActiveFree85Rom(bytes) {
  return (await sha256Hex(bytes)) === ACTIVE_FREE85_ROM_SHA256;
}

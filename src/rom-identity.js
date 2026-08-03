export const FREE85_RELEASE_210_SHA256 = "dc91f6d59ac3ab930216f7642a68284fdb8d6255170934c9c5733b360df160f0";

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

export async function isFree85Release210Rom(bytes) {
  return (await sha256Hex(bytes)) === FREE85_RELEASE_210_SHA256;
}

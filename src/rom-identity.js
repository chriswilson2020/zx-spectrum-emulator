export const ACTIVE_FREE85_RELEASE = "Release_2.21";
export const ACTIVE_FREE85_ROM_SHA256 = "b714dd191c4182c294017f6fe19f1699db039c9579fc39eef1dd568afb05339d";

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

export const ACTIVE_FREE85_RELEASE = "Release_3.0";
export const ACTIVE_FREE85_ROM_SHA256 = "f1e80e901e048fe59363613ec9ed0d237505aa748ca0e395300c692c62c3d6f4";

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

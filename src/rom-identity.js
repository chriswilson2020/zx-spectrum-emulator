export const ACTIVE_FREE85_RELEASE = "Release_2.20_Docs";
export const ACTIVE_FREE85_ROM_SHA256 = "fc3f889ff0cc0c70f3fd02b74768ce37a4d6c8f2eb8af883d5057d9b6e1e9de3";

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

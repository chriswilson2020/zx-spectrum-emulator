export function normalizeTapeUrl(value, baseUrl = globalThis.location?.href ?? "https://localhost/") {
  const input = String(value ?? "").trim();
  if (!input) throw new Error("Tape URL is empty");
  const url = new URL(input, baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported tape URL scheme: " + url.protocol);
  if (url.hostname.toLowerCase() === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 5 && parts[2] === "blob") {
      return "https://raw.githubusercontent.com/" + parts[0] + "/" + parts[1] + "/" + parts[3] + "/" + parts.slice(4).join("/");
    }
  }
  return url.href;
}

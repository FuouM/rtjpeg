/** Upper bound on base64url input length passed to `decodeBase64Url` (avoids huge allocations). */
export const MAX_BASE64URL_DECODE_INPUT_CHARS = 256 * 1024;

export function encodeBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodeBase64Url(value: string): string {
  if (value.length > MAX_BASE64URL_DECODE_INPUT_CHARS) {
    throw new Error("Base64 payload too large.");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + padding);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const API_SIGN_SECRET = import.meta.env.VITE_API_SIGN_SECRET || "";

const EMPTY_BODY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const CLIENT_SALT = "jiadian-api-sign-v1";

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(digest);
}

async function hmacSha256Hex(keyBytes: ArrayBuffer, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return bytesToHex(signature);
}

async function deriveSignKeyBytes(bearerToken: string): Promise<ArrayBuffer> {
  const secretBytes = new TextEncoder().encode(API_SIGN_SECRET);
  const secretKey = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const material = bearerToken.trim() || CLIENT_SALT;
  return crypto.subtle.sign("HMAC", secretKey, new TextEncoder().encode(material));
}

function buildCanonicalString(
  method: string,
  pathWithQuery: string,
  timestamp: string,
  nonce: string,
  bodyHash: string,
): string {
  return `${method.toUpperCase()}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes.buffer);
}

function extractBearerToken(headers: HeadersInit | undefined): string {
  if (!headers) return "";
  const source = headers instanceof Headers ? headers : new Headers(headers);
  const auth = source.get("Authorization") || source.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

export function isApiSigningEnabled(): boolean {
  return Boolean(API_SIGN_SECRET.trim());
}

export async function buildApiSignHeaders(
  pathWithQuery: string,
  method: string,
  bodyText: string | undefined,
  bearerToken = "",
): Promise<Record<string, string>> {
  if (!isApiSigningEnabled()) {
    return {};
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomNonce();
  const bodyHash = bodyText ? await sha256Hex(bodyText) : EMPTY_BODY_SHA256;
  const signKey = await deriveSignKeyBytes(bearerToken);
  const signature = await hmacSha256Hex(
    signKey,
    buildCanonicalString(method, pathWithQuery, timestamp, nonce, bodyHash),
  );

  return {
    "X-Api-Timestamp": timestamp,
    "X-Api-Nonce": nonce,
    "X-Api-Signature": signature,
  };
}

export async function withApiSignature(
  pathWithQuery: string,
  init: RequestInit = {},
): Promise<RequestInit> {
  const method = (init.method || "GET").toUpperCase();
  const bodyText = typeof init.body === "string" ? init.body : undefined;
  const bearerToken = extractBearerToken(init.headers);
  const signHeaders = await buildApiSignHeaders(pathWithQuery, method, bodyText, bearerToken);
  const merged = new Headers(init.headers || {});
  Object.entries(signHeaders).forEach(([key, value]) => merged.set(key, value));
  return {
    ...init,
    headers: merged,
  };
}

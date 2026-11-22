import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { URL } from "node:url";

export const redactSecrets = (value: unknown): unknown => {
  if (typeof value === "string") return value.replace(/(sk-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_-]{8,})/g, "[REDACTED]");
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [/key|token|secret|password|authorization|apiKey/i.test(key) ? key : key, /key|token|secret|password|authorization|apiKey/i.test(key) ? "[REDACTED]" : redactSecrets(item)]));
  return value;
};

const privateIp = (hostname: string) => {
  const lower = hostname.toLowerCase();
  return lower === "localhost" || lower === "::1" || lower.startsWith("127.") || lower.startsWith("10.") || lower.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(lower) || lower.endsWith(".local");
};

export const assertSafeHttpUrl = (raw: string, allowlist: string[] = []): URL => {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error("Only HTTP(S) URLs are allowed");
  if (privateIp(url.hostname)) throw new Error("Private/local network URLs are not allowed");
  if (allowlist.length && !allowlist.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error("URL is outside the configured allowlist");
  url.username = "";
  url.password = "";
  return url;
};

export const hashSha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

export const makeApprovalToken = () => randomBytes(24).toString("base64url");
export const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

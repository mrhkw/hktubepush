import { hashSha256 } from "./security.js";
import type { Attachment, FileInspection } from "./types.js";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const textTypes = /^(text\/|application\/(json|javascript|typescript|xml|yaml|x-yaml)|image\/svg\+xml)/i;
const imageTypes = /^image\//i;
const audioTypes = /^audio\//i;
const videoTypes = /^video\//i;

export const inspectAttachment = (attachment: Attachment): FileInspection => {
  const data = Buffer.from(attachment.dataBase64, "base64");
  if (!attachment.name || !attachment.mimeType || data.length === 0) throw new Error("Attachment must include name, mimeType and non-empty base64 data");
  if (data.length > MAX_FILE_BYTES) throw new Error(`Attachment exceeds ${MAX_FILE_BYTES} byte limit`);
  const kind: FileInspection["kind"] = textTypes.test(attachment.mimeType) ? "text" : imageTypes.test(attachment.mimeType) ? "image" : audioTypes.test(attachment.mimeType) ? "audio" : videoTypes.test(attachment.mimeType) ? "video" : "binary";
  const result: FileInspection = { name: attachment.name.slice(0, 200), mimeType: attachment.mimeType, sizeBytes: data.length, kind, sha256: hashSha256(data) };
  if (kind === "text") result.text = data.toString("utf8").slice(0, 200_000);
  return result;
};

export const prepareAttachments = (attachments: Attachment[] = []) => attachments.map(attachment => {
  const inspected = inspectAttachment(attachment);
  return { attachment, inspected };
});

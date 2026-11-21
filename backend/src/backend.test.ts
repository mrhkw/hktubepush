import assert from "node:assert/strict";
import test from "node:test";
import { chooseProvider } from "./providers.js";
import { assertSafeHttpUrl } from "./security.js";
import { inspectAttachment } from "./files.js";
import { createPlan } from "./agent.js";

test("routes multimodal requests to Gemini", () => {
  assert.equal(chooseProvider({ messages: [{ role: "user", content: "look at this" }], attachments: [{ name: "a.png", mimeType: "image/png", dataBase64: "aA==" }] }), "gemini");
});
test("routes code requests to OpenAI and research to Gemini", () => {
  assert.equal(chooseProvider({ messages: [{ role: "user", content: "debug this complex architecture" }], taskType: "code" }), "openai");
  assert.equal(chooseProvider({ messages: [{ role: "user", content: "research latest sources" }], taskType: "research" }), "gemini");
});
test("blocks private network URLs", () => {
  assert.throws(() => assertSafeHttpUrl("http://127.0.0.1:8080/internal"));
});
test("inspects text attachments without persisting them", () => {
  const result = inspectAttachment({ name: "notes.txt", mimeType: "text/plain", dataBase64: Buffer.from("hello").toString("base64") });
  assert.equal(result.kind, "text");
  assert.equal(result.text, "hello");
  assert.equal(result.sizeBytes, 5);
});
test("creates bounded plans with risky write recognition", () => {
  const plan = createPlan("Use GitHub to create a pull request");
  assert.ok(plan.some(step => step.tool === "github"));
});

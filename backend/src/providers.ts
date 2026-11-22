import { config, providerKey } from "./config.js";
import { prepareAttachments } from "./files.js";
import type { ChatMessage, ChatRequest, ChatResult, ProviderCredentials, ProviderName } from "./types.js";

const jsonHeaders = { "content-type": "application/json" };
const withTimeout = async (input: RequestInfo | URL, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
};

const messageText = (message: ChatMessage) => typeof message.content === "string" ? message.content : message.content.map(part => part.text ?? "").join(" ");
const taskText = (request: ChatRequest) => request.messages.map(messageText).join(" ").toLowerCase();

export const chooseProvider = (request: ChatRequest): ProviderName => {
  if (request.provider && request.provider !== "auto") return request.provider;
  const text = taskText(request);
  if (request.attachments?.some(file => /^image\//.test(file.mimeType) || /^video\//.test(file.mimeType) || /^audio\//.test(file.mimeType)) || request.taskType === "multimodal") return "gemini";
  if (request.taskType === "code" || /architect|debug|refactor|security|complex/.test(text)) return "openai";
  if (request.taskType === "research" || /research|compare|sources|latest/.test(text)) return "gemini";
  return "groq";
};

const credentialsFor = (provider: ProviderName, supplied?: ProviderCredentials) => {
  const entry = supplied?.[provider];
  const apiKey = providerKey(provider, entry?.apiKey);
  if (!apiKey) throw new Error(`No ${provider} API key configured. Add a user key in the app or configure ${provider.toUpperCase()}_API_KEY.`);
  return { apiKey, baseUrl: entry?.baseUrl, model: entry?.model };
};

const openAiCompatible = async (provider: "openai" | "groq", request: ChatRequest, stream: boolean) => {
  const credentials = credentialsFor(provider, request.credentials);
  const baseUrl = credentials.baseUrl ?? (provider === "openai" ? config.providers.openaiBaseUrl : config.providers.groqBaseUrl);
  const attachmentParts = (request.attachments ?? []).map(attachment => {
    if (attachment.mimeType.startsWith("image/")) return { type: "image_url" as const, image_url: { url: `data:${attachment.mimeType};base64,${attachment.dataBase64}` } };
    if (attachment.mimeType.startsWith("audio/")) return { type: "input_audio" as const, input_audio: { data: attachment.dataBase64, format: attachment.mimeType.split("/")[1] ?? "wav" } };
    return { type: "inline_data" as const, inline_data: { mime_type: attachment.mimeType, data: attachment.dataBase64 } };
  });
  const messages = [
    ...(request.systemPrompt ? [{ role: "system" as const, content: request.systemPrompt }] : []),
    ...request.messages.map(message => ({ role: message.role, content: message.content })),
    ...(attachmentParts.length ? [{ role: "user" as const, content: [{ type: "text" as const, text: "User attachments:" }, ...attachmentParts] }] : []),
  ];
  const response = await withTimeout(`${baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { ...jsonHeaders, authorization: `Bearer ${credentials.apiKey}` }, body: JSON.stringify({ model: credentials.model ?? (provider === "openai" ? config.providers.openaiDefaultModel : config.providers.groqDefaultModel), messages, temperature: request.temperature ?? 0.2, max_tokens: request.maxTokens ?? 4096, stream }) }, config.requestTimeoutMs);
  if (!response.ok) throw new Error(`${provider} request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return { response, model: credentials.model ?? (provider === "openai" ? config.providers.openaiDefaultModel : config.providers.groqDefaultModel) };
};

const gemini = async (request: ChatRequest, stream: boolean) => {
  const credentials = credentialsFor("gemini", request.credentials);
  const baseUrl = credentials.baseUrl ?? config.providers.geminiBaseUrl;
  const contents = request.messages.filter(message => message.role !== "system").map(message => ({ role: message.role === "assistant" ? "model" : "user", parts: typeof message.content === "string" ? [{ text: message.content }] : message.content.map(part => part.type === "text" ? { text: part.text ?? "" } : part.type === "inline_data" ? { inline_data: part.inline_data } : part.type === "image_url" ? { inline_data: { mime_type: "image/jpeg", data: (part.image_url?.url ?? "").split(",").pop() ?? "" } } : part.type === "input_audio" ? { inline_data: { mime_type: `audio/${part.input_audio?.format ?? "wav"}`, data: part.input_audio?.data ?? "" } } : { text: "[unsupported attachment]" }) }));
  if (request.attachments?.length) contents.push({ role: "user", parts: request.attachments.map(attachment => ({ inline_data: { mime_type: attachment.mimeType, data: attachment.dataBase64 } })) });
  const systemInstruction = request.systemPrompt ? { systemInstruction: { parts: [{ text: request.systemPrompt }] } } : {};
  const model = credentials.model ?? config.providers.geminiDefaultModel;
  const endpoint = stream ? `${baseUrl.replace(/\/$/, "")}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(credentials.apiKey)}` : `${baseUrl.replace(/\/$/, "")}/models/${model}:generateContent?key=${encodeURIComponent(credentials.apiKey)}`;
  const response = await withTimeout(endpoint, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ ...systemInstruction, contents, generationConfig: { temperature: request.temperature ?? 0.2, maxOutputTokens: request.maxTokens ?? 4096 } }) }, config.requestTimeoutMs);
  if (!response.ok) throw new Error(`gemini request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return { response, model };
};

const extractGeminiText = (json: any) => json?.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? "").join("") ?? "";

export const chat = async (request: ChatRequest): Promise<ChatResult> => {
  const provider = chooseProvider(request);
  prepareAttachments(request.attachments);
  const normalized = { ...request };
  if (provider === "gemini") {
    const { response, model } = await gemini(normalized, false);
    const json = await response.json();
    return { provider, model, text: extractGeminiText(json), usage: json.usageMetadata ? { inputTokens: json.usageMetadata.promptTokenCount, outputTokens: json.usageMetadata.candidatesTokenCount, totalTokens: json.usageMetadata.totalTokenCount } : undefined };
  }
  const { response, model } = await openAiCompatible(provider, normalized, false);
  const json = await response.json();
  return { provider, model, text: json.choices?.[0]?.message?.content ?? "", usage: json.usage ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens, totalTokens: json.usage.total_tokens } : undefined };
};

export async function* streamChat(request: ChatRequest): AsyncGenerator<{ type: "provider" | "token" | "done"; provider?: ProviderName; model?: string; text?: string }> {
  const provider = chooseProvider(request);
  const { response, model } = provider === "gemini" ? await gemini(request, true) : await openAiCompatible(provider, request, true);
  yield { type: "provider", provider, model };
  if (!response.body) { yield { type: "done" }; return; }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const raw = line.replace(/^data:\s*/, "").trim();
      if (!raw || raw === "[DONE]") continue;
      try {
        const json = JSON.parse(raw);
        const text = provider === "gemini" ? extractGeminiText(json) : json.choices?.[0]?.delta?.content ?? "";
        if (text) yield { type: "token", text };
      } catch { /* providers may split JSON across chunks; the next chunk will complete it */ }
    }
  }
  yield { type: "done" };
}

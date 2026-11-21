import * as SecureStore from "expo-secure-store";

export type ProviderId = "openai" | "gemini" | "anthropic" | "deepseek" | "groq" | "openrouter" | "cloudflare";
export type ProviderDefinition = {
  id: ProviderId;
  label: string;
  keyLabel: string;
  baseModel: string;
  modelsEndpoint?: string;
  keyName: string;
  accountIdName?: string;
};
export type ModelOption = { id: string; name: string; provider: ProviderId };

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  openai: { id: "openai", label: "OpenAI", keyLabel: "API key", baseModel: "gpt-4.1-mini", modelsEndpoint: "https://api.openai.com/v1/models", keyName: "OPENAI_API_KEY" },
  gemini: { id: "gemini", label: "Google Gemini", keyLabel: "API key", baseModel: "gemini-2.5-flash", keyName: "GEMINI_API_KEY" },
  anthropic: { id: "anthropic", label: "Anthropic Claude", keyLabel: "API key", baseModel: "claude-3-5-haiku-latest", modelsEndpoint: "https://api.anthropic.com/v1/models", keyName: "ANTHROPIC_API_KEY" },
  deepseek: { id: "deepseek", label: "DeepSeek", keyLabel: "API key", baseModel: "deepseek-chat", modelsEndpoint: "https://api.deepseek.com/models", keyName: "DEEPSEEK_API_KEY" },
  groq: { id: "groq", label: "Groq", keyLabel: "API key", baseModel: "llama-3.3-70b-versatile", modelsEndpoint: "https://api.groq.com/openai/v1/models", keyName: "GROQ_API_KEY" },
  openrouter: { id: "openrouter", label: "OpenRouter", keyLabel: "API key", baseModel: "openai/gpt-4.1-mini", modelsEndpoint: "https://openrouter.ai/api/v1/models", keyName: "OPENROUTER_API_KEY" },
  cloudflare: { id: "cloudflare", label: "Cloudflare Workers AI", keyLabel: "API token", baseModel: "@cf/meta/llama-3.1-8b-instruct", keyName: "CLOUDFLARE_API_TOKEN", accountIdName: "CLOUDFLARE_ACCOUNT_ID" },
};

const PREFIX = "pa_ios_secret_v2_";
const MODEL_PREFIX = "pa_ios_model_v2_";
const ACCOUNT_PREFIX = "pa_ios_account_v2_";

export async function saveProviderSecret(id: ProviderId, secret: string): Promise<void> {
  const value = secret.trim();
  if (!value) throw new Error("API key cannot be empty.");
  await SecureStore.setItemAsync(PREFIX + id, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
export async function readProviderSecret(id: ProviderId): Promise<string> {
  return (await SecureStore.getItemAsync(PREFIX + id)) ?? "";
}
export async function removeProviderSecret(id: ProviderId): Promise<void> {
  await SecureStore.deleteItemAsync(PREFIX + id);
}
export async function saveCloudflareAccountId(value: string): Promise<void> {
  const clean = value.trim();
  if (!/^[a-f0-9]{32}$/i.test(clean)) throw new Error("Cloudflare Account ID must be 32 hexadecimal characters.");
  await SecureStore.setItemAsync(ACCOUNT_PREFIX + "cloudflare", clean, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
export async function readCloudflareAccountId(): Promise<string> {
  return (await SecureStore.getItemAsync(ACCOUNT_PREFIX + "cloudflare")) ?? "";
}
export async function saveSelectedModel(id: ProviderId, model: string): Promise<void> {
  await SecureStore.setItemAsync(MODEL_PREFIX + id, model, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
export async function readSelectedModel(id: ProviderId): Promise<string> {
  return (await SecureStore.getItemAsync(MODEL_PREFIX + id)) ?? PROVIDERS[id].baseModel;
}

function modelListFrom(value: unknown, provider: ProviderId): ModelOption[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const rows = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  return rows.flatMap((row): ModelOption[] => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : "";
    if (!id) return [];
    return [{ id, name: typeof item.name === "string" ? item.name : id, provider }];
  });
}
export async function discoverModels(id: ProviderId): Promise<ModelOption[]> {
  const definition = PROVIDERS[id];
  if (id === "gemini") {
    const key = await readProviderSecret(id);
    if (!key) throw new Error("Save your Gemini API key first.");
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(key));
    const data: unknown = await response.json();
    if (!response.ok) throw new Error("Gemini model discovery failed. Check key and quota.");
    const rows = data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).models) ? (data as { models: unknown[] }).models : [];
    return rows.flatMap((row): ModelOption[] => {
      if (!row || typeof row !== "object") return [];
      const item = row as Record<string, unknown>;
      const name = typeof item.name === "string" ? item.name.replace(/^models\//, "") : "";
      const methods = Array.isArray(item.supportedGenerationMethods) ? item.supportedGenerationMethods : [];
      return name && methods.includes("generateContent") ? [{ id: name, name, provider: id }] : [];
    });
  }
  if (id === "cloudflare") {
    const key = await readProviderSecret(id);
    const accountId = await readCloudflareAccountId();
    if (!key || !accountId) throw new Error("Save Cloudflare API token and Account ID first.");
    const response = await fetch("https://api.cloudflare.com/client/v4/accounts/" + accountId + "/ai/models/search", { headers: { Authorization: "Bearer " + key } });
    const data: unknown = await response.json();
    if (!response.ok) throw new Error("Cloudflare model discovery failed. Check token permissions and Account ID.");
    const rows = data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).result) ? (data as { result: unknown[] }).result : [];
    return rows.flatMap((row): ModelOption[] => {
      if (!row || typeof row !== "object") return [];
      const item = row as Record<string, unknown>;
      const idValue = typeof item.name === "string" ? item.name : "";
      return idValue ? [{ id: idValue, name: idValue, provider }] : [];
    });
  }
  const key = await readProviderSecret(id);
  if (!key) throw new Error("Save the " + definition.label + " API key first.");
  if (!definition.modelsEndpoint) return [{ id: definition.baseModel, name: definition.baseModel, provider: id }];
  const headers: Record<string, string> = { Authorization: "Bearer " + key };
  if (id === "anthropic") { headers["x-api-key"] = key; headers["anthropic-version"] = "2023-06-01"; }
  const response = await fetch(definition.modelsEndpoint, { headers });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(definition.label + " model discovery failed. Check API key and model access.");
  const models = modelListFrom(data, id);
  return models.length ? models : [{ id: definition.baseModel, name: definition.baseModel, provider: id }];
}
export async function autoSelectModel(id: ProviderId): Promise<ModelOption> {
  const models = await discoverModels(id);
  const preferred = models.find((item) => item.id === PROVIDERS[id].baseModel) ?? models.find((item) => /flash|mini|haiku|8b|70b/i.test(item.id)) ?? models[0];
  if (!preferred) throw new Error("No compatible models were returned by this provider.");
  await saveSelectedModel(id, preferred.id);
  return preferred;
}
export async function getProviderModel(id: ProviderId): Promise<string> {
  return readSelectedModel(id);
}

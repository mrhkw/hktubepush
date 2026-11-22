import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { Credentials, ManualPlugin } from "./api";

export type Chat = { id: string; title: string; messages: Array<{ id: string; role: "user" | "assistant"; content: string; bookmarked?: boolean }>; pinned: boolean; createdAt: string; updatedAt: string };
export type Preferences = { backendUrl: string; provider: "openai" | "gemini" | "groq"; persona: string; webhookAllowlist: string[]; models: { openai: string; gemini: string; groq: string } };
const PREFS = "hktube-agent:preferences";
const CHATS = "hktube-agent:chats";
const PLUGINS = "hktube-agent:manual-plugins";
const SECRET_PREFIX = "hktube-agent:secret:";
const FALLBACK_SECRETS = `${SECRET_PREFIX}fallback`;
const SECRET_KEYS: Record<keyof SecretState, string> = { openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY", github: "GITHUB_TOKEN", backendSecret: "BACKEND_SHARED_SECRET" };

export const defaultPreferences: Preferences = { backendUrl: "", provider: "groq", persona: "General Assistant", webhookAllowlist: [], models: { openai: "gpt-4o-mini", gemini: "gemini-2.0-flash", groq: "llama-3.3-70b-versatile" } };
const mergePreferences = (value: Partial<Preferences>): Preferences => ({ ...defaultPreferences, ...value, models: { ...defaultPreferences.models, ...(value.models ?? {}) }, webhookAllowlist: Array.isArray(value.webhookAllowlist) ? value.webhookAllowlist : defaultPreferences.webhookAllowlist });
export const loadPreferences = async (): Promise<Preferences> => { try { const value = await AsyncStorage.getItem(PREFS); return value ? mergePreferences(JSON.parse(value)) : defaultPreferences; } catch { return defaultPreferences; } };
export const savePreferences = async (value: Preferences) => { await AsyncStorage.setItem(PREFS, JSON.stringify(mergePreferences(value))); };
export const loadChats = async (): Promise<Chat[]> => { try { const value = await AsyncStorage.getItem(CHATS); return value ? JSON.parse(value) : []; } catch { return []; } };
export const saveChats = (value: Chat[]) => AsyncStorage.setItem(CHATS, JSON.stringify(value.slice(0, 100)));
export const loadManualPlugins = async (): Promise<ManualPlugin[]> => {
  try { const value = await AsyncStorage.getItem(PLUGINS); return value ? JSON.parse(value) : []; } catch { return []; }
};

// Android can reject the keystore operation when no secure lock screen is
// configured, after a lock-screen change, or when the keystore is invalidated.
// The fallback is explicit and surfaced to the user; values are never logged.
type FallbackStore = Record<string, string>;
let secureStoreAvailable: boolean | undefined;
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const readFallbackStore = async (): Promise<FallbackStore> => {
  try {
    const value = await AsyncStorage.getItem(FALLBACK_SECRETS);
    if (!value) return {};
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as FallbackStore : {};
  } catch { return {}; }
};
const writeFallbackStore = async (store: FallbackStore) => AsyncStorage.setItem(FALLBACK_SECRETS, JSON.stringify(store));
const updateFallbackStore = async (values: Record<string, string | null>) => {
  const store = await readFallbackStore();
  for (const [key, value] of Object.entries(values)) store[key] = value ?? "";
  await writeFallbackStore(store);
};
const removeFallbackKeys = async (keys: string[]) => {
  const store = await readFallbackStore();
  let changed = false;
  for (const key of keys) if (hasOwn(store, key)) { delete store[key]; changed = true; }
  if (changed) await writeFallbackStore(store);
};
const checkSecureStore = async () => {
  if (secureStoreAvailable !== undefined) return secureStoreAvailable;
  try { secureStoreAvailable = await SecureStore.isAvailableAsync(); }
  catch { secureStoreAvailable = false; }
  return secureStoreAvailable;
};
const readProtected = async (key: string): Promise<string | null> => {
  const fallback = await readFallbackStore();
  // Fallback values take precedence so stale secure values cannot reappear
  // after a partial secure write failure.
  if (hasOwn(fallback, key)) return fallback[key] ?? "";
  if (!(await checkSecureStore())) return null;
  try { return await SecureStore.getItemAsync(key); }
  catch { secureStoreAvailable = false; return (await readFallbackStore())[key] ?? null; }
};
const writeProtectedBatch = async (values: Record<string, string | null>): Promise<"secure" | "fallback"> => {
  const keys = Object.keys(values);
  if (await checkSecureStore()) {
    try {
      for (const [key, value] of Object.entries(values)) {
        if (value) await SecureStore.setItemAsync(key, value);
        else await SecureStore.deleteItemAsync(key);
      }
      await removeFallbackKeys(keys);
      return "secure";
    } catch { secureStoreAvailable = false; }
  }
  await updateFallbackStore(values);
  return "fallback";
};

export const saveManualPlugins = async (plugins: ManualPlugin[]) => {
  const safe = plugins.map(plugin => ({ ...plugin, secret: undefined, password: undefined }));
  await AsyncStorage.setItem(PLUGINS, JSON.stringify(safe));
  const protectedValues: Record<string, string | null> = {};
  for (const plugin of plugins) {
    protectedValues[`${SECRET_PREFIX}PLUGIN_${plugin.id}_SECRET`] = plugin.secret ?? null;
    protectedValues[`${SECRET_PREFIX}PLUGIN_${plugin.id}_PASSWORD`] = plugin.password ?? null;
  }
  await writeProtectedBatch(protectedValues);
};
export const hydrateManualPlugins = async (plugins: ManualPlugin[]) => Promise.all(plugins.map(async plugin => ({ ...plugin, secret: (await readProtected(`${SECRET_PREFIX}PLUGIN_${plugin.id}_SECRET`)) || undefined, password: (await readProtected(`${SECRET_PREFIX}PLUGIN_${plugin.id}_PASSWORD`)) || undefined })));
export const loadSecrets = async (): Promise<Partial<SecretState>> => {
  const keys: Array<keyof SecretState> = ["openai", "gemini", "groq", "github", "backendSecret"];
  const values = await Promise.all(keys.map(async key => {
    const canonical = `${SECRET_PREFIX}${SECRET_KEYS[key]}`;
    const current = await readProtected(canonical);
    if (current) return [key, current] as const;
    const legacy = await readProtected(`${SECRET_PREFIX}${key}`);
    if (legacy) await writeProtectedBatch({ [canonical]: legacy });
    return [key, legacy ?? ""] as const;
  }));
  return Object.fromEntries(values) as Partial<SecretState>;
};
export type SaveSecretsResult = { storage: "secure" | "fallback"; warning?: string };
export const saveSecrets = async (secrets: SecretState): Promise<SaveSecretsResult> => {
  const keys: Array<keyof SecretState> = ["openai", "gemini", "groq", "github", "backendSecret"];
  const values: Record<string, string | null> = {};
  for (const key of keys) values[`${SECRET_PREFIX}${SECRET_KEYS[key]}`] = secrets[key].trim() || null;
  const storage = await writeProtectedBatch(values);
  return storage === "secure"
    ? { storage }
    : { storage, warning: "Android SecureStore is unavailable on this device. Credentials were saved in app storage with reduced protection. Enable a screen lock, then save again to restore secure storage." };
};
export type SecretState = { openai: string; gemini: string; groq: string; github: string; backendSecret: string };
export const emptySecrets: SecretState = { openai: "", gemini: "", groq: "", github: "", backendSecret: "" };
export const credentialsFromSecrets = (secrets: SecretState, models = defaultPreferences.models): Credentials => ({ openai: secrets.openai ? { apiKey: secrets.openai, model: models.openai } : undefined, gemini: secrets.gemini ? { apiKey: secrets.gemini, model: models.gemini } : undefined, groq: secrets.groq ? { apiKey: secrets.groq, model: models.groq } : undefined });

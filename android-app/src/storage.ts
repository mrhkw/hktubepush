import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { Credentials, ManualPlugin } from "./api";

export type Chat = { id: string; title: string; messages: Array<{ id: string; role: "user" | "assistant"; content: string; bookmarked?: boolean }>; pinned: boolean; createdAt: string; updatedAt: string };
export type Preferences = { backendUrl: string; provider: "openai" | "gemini" | "groq"; persona: string; webhookAllowlist: string[]; models: { openai: string; gemini: string; groq: string } };
const PREFS = "hktube-agent:preferences";
const CHATS = "hktube-agent:chats";
const PLUGINS = "hktube-agent:manual-plugins";
const SECRET_PREFIX = "hktube-agent:secret:";
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
export const saveManualPlugins = async (plugins: ManualPlugin[]) => {
  const safe = plugins.map(plugin => ({ ...plugin, secret: undefined, password: undefined }));
  await AsyncStorage.setItem(PLUGINS, JSON.stringify(safe));
  for (const plugin of plugins) {
    if (plugin.secret) await SecureStore.setItemAsync(`${SECRET_PREFIX}PLUGIN_${plugin.id}_SECRET`, plugin.secret); else await SecureStore.deleteItemAsync(`${SECRET_PREFIX}PLUGIN_${plugin.id}_SECRET`);
    if (plugin.password) await SecureStore.setItemAsync(`${SECRET_PREFIX}PLUGIN_${plugin.id}_PASSWORD`, plugin.password); else await SecureStore.deleteItemAsync(`${SECRET_PREFIX}PLUGIN_${plugin.id}_PASSWORD`);
  }
};
export const hydrateManualPlugins = async (plugins: ManualPlugin[]) => Promise.all(plugins.map(async plugin => ({ ...plugin, secret: (await SecureStore.getItemAsync(`${SECRET_PREFIX}PLUGIN_${plugin.id}_SECRET`)) ?? undefined, password: (await SecureStore.getItemAsync(`${SECRET_PREFIX}PLUGIN_${plugin.id}_PASSWORD`)) ?? undefined })));
export const loadSecrets = async (): Promise<Partial<SecretState>> => {
  const keys: Array<keyof SecretState> = ["openai", "gemini", "groq", "github", "backendSecret"];
  const values = await Promise.all(keys.map(async key => {
    const canonical = `${SECRET_PREFIX}${SECRET_KEYS[key]}`;
    const current = await SecureStore.getItemAsync(canonical);
    if (current) return [key, current] as const;
    const legacy = await SecureStore.getItemAsync(`${SECRET_PREFIX}${key}`);
    if (legacy) await SecureStore.setItemAsync(canonical, legacy);
    return [key, legacy ?? ""] as const;
  }));
  return Object.fromEntries(values) as Partial<SecretState>;
};
export const saveSecrets = async (secrets: SecretState) => {
  const keys: Array<keyof SecretState> = ["openai", "gemini", "groq", "github", "backendSecret"];
  try { for (const key of keys) { const value = secrets[key].trim(); const storageKey = `${SECRET_PREFIX}${SECRET_KEYS[key]}`; if (value) await SecureStore.setItemAsync(storageKey, value); else await SecureStore.deleteItemAsync(storageKey); } }
  catch { throw new Error("Could not save credentials securely on this device. Check device security settings and try again."); }
};
export type SecretState = { openai: string; gemini: string; groq: string; github: string; backendSecret: string };
export const emptySecrets: SecretState = { openai: "", gemini: "", groq: "", github: "", backendSecret: "" };
export const credentialsFromSecrets = (secrets: SecretState, models = defaultPreferences.models): Credentials => ({ openai: secrets.openai ? { apiKey: secrets.openai, model: models.openai } : undefined, gemini: secrets.gemini ? { apiKey: secrets.gemini, model: models.gemini } : undefined, groq: secrets.groq ? { apiKey: secrets.groq, model: models.groq } : undefined });

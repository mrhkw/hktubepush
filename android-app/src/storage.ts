import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { Credentials } from "./api";

export type Chat = { id: string; title: string; messages: Array<{ id: string; role: "user" | "assistant"; content: string; bookmarked?: boolean }>; pinned: boolean; createdAt: string; updatedAt: string };
export type Preferences = { backendUrl: string; provider: "openai" | "gemini" | "groq"; persona: string; webhookAllowlist: string[]; models: { openai: string; gemini: string; groq: string } };
const PREFS = "hktube-agent:preferences";
const CHATS = "hktube-agent:chats";
const SECRET_PREFIX = "hktube-agent:secret:";

export const defaultPreferences: Preferences = { backendUrl: "http://10.0.2.2:8787", provider: "groq", persona: "General Assistant", webhookAllowlist: [], models: { openai: "gpt-4o-mini", gemini: "gemini-2.0-flash", groq: "llama-3.3-70b-versatile" } };
export const loadPreferences = async (): Promise<Preferences> => { const value = await AsyncStorage.getItem(PREFS); return value ? { ...defaultPreferences, ...JSON.parse(value) } : defaultPreferences; };
export const savePreferences = (value: Preferences) => AsyncStorage.setItem(PREFS, JSON.stringify(value));
export const loadChats = async (): Promise<Chat[]> => { const value = await AsyncStorage.getItem(CHATS); return value ? JSON.parse(value) : []; };
export const saveChats = (value: Chat[]) => AsyncStorage.setItem(CHATS, JSON.stringify(value.slice(0, 100)));
export const loadSecrets = async () => {
  const keys = ["openai", "gemini", "groq", "github", "backendSecret"];
  const values = await Promise.all(keys.map(async key => [key, await SecureStore.getItemAsync(`${SECRET_PREFIX}${key}`)] as const));
  return Object.fromEntries(values);
};
export const saveSecrets = async (secrets: Record<string, string>) => { await Promise.all(Object.entries(secrets).map(([key, value]) => value ? SecureStore.setItemAsync(`${SECRET_PREFIX}${key}`, value) : SecureStore.deleteItemAsync(`${SECRET_PREFIX}${key}`))); };
export type SecretState = { openai: string; gemini: string; groq: string; github: string; backendSecret: string };
export const emptySecrets: SecretState = { openai: "", gemini: "", groq: "", github: "", backendSecret: "" };
export const credentialsFromSecrets = (secrets: SecretState, models = defaultPreferences.models): Credentials => ({ openai: secrets.openai ? { apiKey: secrets.openai, model: models.openai } : undefined, gemini: secrets.gemini ? { apiKey: secrets.gemini, model: models.gemini } : undefined, groq: secrets.groq ? { apiKey: secrets.groq, model: models.groq } : undefined });

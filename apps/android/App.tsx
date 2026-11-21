import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  autoSelectModel,
  discoverModels,
  getProviderModel,
  PROVIDERS,
  ProviderId,
  readCloudflareAccountId,
  readProviderSecret,
  removeProviderSecret,
  saveCloudflareAccountId,
  saveProviderSecret,
  saveSelectedModel,
  ModelOption,
} from "./src/ai/providers";

const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
const MAX_MESSAGE_LENGTH = 20000;

type ProviderSecrets = Record<ProviderId, string>;
type ModelSelections = Record<ProviderId, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(value: unknown): string {
  if (isRecord(value) && isRecord(value.error) && typeof value.error.message === "string") return value.error.message;
  if (isRecord(value) && typeof value.message === "string") return value.message;
  if (isRecord(value) && typeof value.errors === "object") return "The provider rejected the request. Check its key, permissions and model access.";
  return "The provider returned an unexpected response.";
}

async function readJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(body));
  return body;
}

function readOpenAICompatibleText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices)) throw new Error("The provider returned no chat choices.");
  const first: unknown = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== "string") throw new Error("The provider returned no text response.");
  return first.message.content;
}

function readGeminiText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.candidates)) throw new Error("Gemini returned no candidates.");
  const first: unknown = value.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) throw new Error("Gemini returned no text response.");
  return first.content.parts.map((part: unknown) => isRecord(part) && typeof part.text === "string" ? part.text : "").join("");
}

function readAnthropicText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.content)) throw new Error("Claude returned no text response.");
  return value.content.map((part: unknown) => isRecord(part) && typeof part.text === "string" ? part.text : "").join("");
}

async function askProvider(provider: ProviderId, apiKey: string, model: string, prompt: string, cloudflareAccountId: string): Promise<string> {
  let response: Response;
  if (provider === "openai" || provider === "deepseek" || provider === "groq" || provider === "openrouter") {
    const baseUrls: Record<"openai" | "deepseek" | "groq" | "openrouter", string> = {
      openai: "https://api.openai.com/v1",
      deepseek: "https://api.deepseek.com",
      groq: "https://api.groq.com/openai/v1",
      openrouter: "https://openrouter.ai/api/v1",
    };
    response = await fetch(baseUrls[provider] + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.4 }),
    });
    return readOpenAICompatibleText(await readJson(response));
  }

  if (provider === "gemini") {
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    return readGeminiText(await readJson(response));
  }

  if (provider === "anthropic") {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
    });
    return readAnthropicText(await readJson(response));
  }

  if (!cloudflareAccountId) throw new Error("Save your Cloudflare Account ID in API Manager first.");
  response = await fetch("https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(cloudflareAccountId) + "/ai/run/" + model.split("/").map(encodeURIComponent).join("/"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
  });
  const data = await readJson(response);
  if (!isRecord(data) || !isRecord(data.result)) throw new Error("Cloudflare returned no AI result.");
  const result = data.result;
  if (typeof result.response === "string") return result.response;
  if (typeof result.output === "string") return result.output;
  throw new Error("Cloudflare returned an unsupported model response format.");
}

export default function App(): React.JSX.Element {
  const [provider, setProvider] = useState<ProviderId>("gemini");
  const [secrets, setSecrets] = useState<ProviderSecrets>(() => Object.fromEntries(PROVIDER_IDS.map((id) => [id, ""])) as ProviderSecrets);
  const [models, setModels] = useState<ModelSelections>(() => Object.fromEntries(PROVIDER_IDS.map((id) => [id, PROVIDERS[id].baseModel])) as ModelSelections);
  const [modelOptions, setModelOptions] = useState<Partial<Record<ProviderId, ModelOption[]>>>({});
  const [keyInput, setKeyInput] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountIdInput, setAccountIdInput] = useState("");
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState("Ready");

  const selectedProvider = PROVIDERS[provider];
  const selectedModel = models[provider] || selectedProvider.baseModel;
  const selectedModels = modelOptions[provider] ?? [];

  useEffect(() => {
    let active = true;
    void Promise.all([
      ...PROVIDER_IDS.map(async (id) => [id, await readProviderSecret(id)] as const),
      ...PROVIDER_IDS.map(async (id) => [id, await getProviderModel(id)] as const),
      readCloudflareAccountId().then((value) => ["cloudflare-account", value] as const),
    ]).then((entries) => {
      if (!active) return;
      const loadedSecrets = Object.fromEntries(PROVIDER_IDS.map((id) => [id, ""])) as ProviderSecrets;
      const loadedModels = Object.fromEntries(PROVIDER_IDS.map((id) => [id, PROVIDERS[id].baseModel])) as ModelSelections;
      for (const entry of entries) {
        if (entry[0] === "cloudflare-account") {
          setAccountId(entry[1]);
          setAccountIdInput(entry[1]);
        } else if (PROVIDER_IDS.includes(entry[0] as ProviderId)) {
          const id = entry[0] as ProviderId;
          if (entry[1].startsWith("gpt-") || entry[1].includes("/") || entry[1].includes("flash") || entry[1].includes("haiku") || entry[1].includes("llama") || entry[1].includes("deepseek")) loadedModels[id] = entry[1];
          else loadedSecrets[id] = entry[1];
        }
      }
      setSecrets(loadedSecrets);
      setModels(loadedModels);
      setKeyInput(loadedSecrets.gemini);
    }).catch(() => setStatus("Secure storage could not be read."));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setKeyInput(secrets[provider]);
  }, [provider, secrets]);

  const providerReady = useMemo(() => PROVIDER_IDS.filter((id) => secrets[id].length > 0).length, [secrets]);

  const refreshModels = useCallback(async (id: ProviderId): Promise<void> => {
    setSettingsBusy(true);
    setStatus("Discovering " + PROVIDERS[id].label + " models...");
    try {
      const found = await discoverModels(id);
      setModelOptions((current) => ({ ...current, [id]: found }));
      const preferred = await autoSelectModel(id);
      setModels((current) => ({ ...current, [id]: preferred.id }));
      setStatus(found.length + " models found. Default selected: " + preferred.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Model discovery failed.");
    } finally {
      setSettingsBusy(false);
    }
  }, []);

  async function saveCurrentKey(): Promise<void> {
    const value = keyInput.trim();
    if (!value) {
      Alert.alert("API key required", "Paste the " + selectedProvider.label + " key first.");
      return;
    }
    setSettingsBusy(true);
    try {
      await saveProviderSecret(provider, value);
      setSecrets((current) => ({ ...current, [provider]: value }));
      setStatus(selectedProvider.label + " key saved securely on this device.");
      await refreshModels(provider);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save the API key.");
    } finally {
      setSettingsBusy(false);
    }
  }

  async function saveAccountId(): Promise<void> {
    try {
      await saveCloudflareAccountId(accountIdInput);
      setAccountId(accountIdInput.trim());
      setStatus("Cloudflare Account ID saved securely.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Invalid Cloudflare Account ID.");
    }
  }

  async function removeCurrentKey(): Promise<void> {
    setSettingsBusy(true);
    try {
      await removeProviderSecret(provider);
      setSecrets((current) => ({ ...current, [provider]: "" }));
      setKeyInput("");
      setModelOptions((current) => ({ ...current, [provider]: [] }));
      setStatus(selectedProvider.label + " key removed from this device.");
    } catch {
      setStatus("Could not remove this API key.");
    } finally {
      setSettingsBusy(false);
    }
  }

  async function send(): Promise<void> {
    const prompt = message.trim();
    if (!prompt) {
      Alert.alert("Message required", "Enter a message first.");
      return;
    }
    if (prompt.length > MAX_MESSAGE_LENGTH) {
      Alert.alert("Message too long", "Maximum message length is 20,000 characters.");
      return;
    }
    if (!secrets[provider]) {
      setSettingsOpen(true);
      Alert.alert("API key missing", "Save a " + selectedProvider.label + " key in API Manager.");
      return;
    }
    if (provider === "cloudflare" && !accountId) {
      setSettingsOpen(true);
      Alert.alert("Account ID missing", "Save your Cloudflare Account ID in API Manager.");
      return;
    }
    setBusy(true);
    setAnswer("");
    setStatus("Sending request to " + selectedProvider.label + "...");
    try {
      const result = await askProvider(provider, secrets[provider], selectedModel, prompt, accountId);
      setAnswer(result);
      setStatus("Response received from " + selectedProvider.label + ".");
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Unknown provider error.";
      setAnswer("Request failed: " + messageText);
      setStatus("Provider request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>PRIVATE • ANDROID WORKSPACE</Text>
            <Text style={styles.title}>Personal AI OS</Text>
            <Text style={styles.subtitle}>One workspace for your AI providers</Text>
          </View>
          <TouchableOpacity style={styles.settingsButton} onPress={() => setSettingsOpen((value) => !value)}>
            <Text style={styles.settingsText}>{settingsOpen ? "Close" : "API Manager"}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}><Text style={styles.statValue}>{providerReady}/7</Text><Text style={styles.statLabel}>Providers connected</Text></View>
          <View style={styles.statCard}><Text style={styles.statValue}>{selectedModel.length > 15 ? selectedModel.slice(0, 15) + "…" : selectedModel}</Text><Text style={styles.statLabel}>Selected model</Text></View>
        </View>

        {settingsOpen ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>API Manager</Text>
            <Text style={styles.note}>Keys are encrypted by Android SecureStore/Keystore and remain on this device. Provider API usage may cost money. Never share keys or screenshots containing them.</Text>
            <View style={styles.providerGrid}>
              {PROVIDER_IDS.map((id) => (
                <TouchableOpacity key={id} onPress={() => setProvider(id)} style={[styles.providerChip, provider === id && styles.providerActive]}>
                  <Text style={styles.providerText}>{PROVIDERS[id].label}</Text>
                  <Text style={styles.providerState}>{secrets[id] ? "Connected" : "Not set"}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldLabel}>{selectedProvider.label} {selectedProvider.keyLabel}</Text>
            <TextInput value={keyInput} onChangeText={setKeyInput} placeholder={"Paste " + selectedProvider.label + " key"} placeholderTextColor="#7b8191" secureTextEntry autoCapitalize="none" autoCorrect={false} style={styles.input} />
            {provider === "cloudflare" ? (
              <>
                <Text style={styles.fieldLabel}>Cloudflare Account ID</Text>
                <TextInput value={accountIdInput} onChangeText={setAccountIdInput} placeholder="32-character Account ID" placeholderTextColor="#7b8191" autoCapitalize="none" autoCorrect={false} style={styles.input} />
                <TouchableOpacity style={styles.secondaryButton} onPress={() => void saveAccountId()}><Text style={styles.buttonText}>Save Account ID</Text></TouchableOpacity>
              </>
            ) : null}
            <View style={styles.actionRow}>
              <TouchableOpacity disabled={settingsBusy} style={[styles.primaryButton, settingsBusy && styles.disabled]} onPress={() => void saveCurrentKey()}>
                {settingsBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save key + auto-detect model</Text>}
              </TouchableOpacity>
              <TouchableOpacity disabled={settingsBusy || !secrets[provider]} style={styles.secondaryButton} onPress={() => void removeCurrentKey()}><Text style={styles.buttonText}>Remove</Text></TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Available models</Text>
            {selectedModels.length ? selectedModels.slice(0, 30).map((item) => (
              <TouchableOpacity key={item.id} style={[styles.modelRow, selectedModel === item.id && styles.modelActive]} onPress={() => {
                void saveSelectedModel(provider, item.id).then(() => {
                  setModels((current) => ({ ...current, [provider]: item.id }));
                  setStatus("Model selected: " + item.id);
                }).catch(() => setStatus("Could not save selected model."));
              }}>
                <Text style={styles.modelText}>{item.name}</Text><Text style={styles.modelMark}>{selectedModel === item.id ? "Selected" : "Use model"}</Text>
              </TouchableOpacity>
            )) : <Text style={styles.note}>Save a key to discover models automatically. Some providers may return only models available to your account.</Text>}
            <TouchableOpacity disabled={settingsBusy || !secrets[provider]} style={styles.secondaryButton} onPress={() => void refreshModels(provider)}><Text style={styles.buttonText}>Refresh model list</Text></TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>New conversation</Text>
          <Text style={styles.fieldLabel}>AI provider</Text>
          <View style={styles.providerGrid}>
            {PROVIDER_IDS.map((id) => (
              <TouchableOpacity key={id} onPress={() => setProvider(id)} style={[styles.providerChip, provider === id && styles.providerActive]}>
                <Text style={styles.providerText}>{PROVIDERS[id].label}</Text>
                <Text style={styles.providerState}>{secrets[id] ? "Ready" : "Add key"}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.fieldLabel}>Model: {selectedModel}</Text>
          <TextInput value={message} onChangeText={setMessage} placeholder="What do you want your AI to do?" placeholderTextColor="#7b8191" multiline maxLength={MAX_MESSAGE_LENGTH} style={[styles.input, styles.messageInput]} />
          <TouchableOpacity disabled={busy} onPress={() => void send()} style={[styles.primaryButton, styles.sendButton, busy && styles.disabled]}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send message</Text>}
          </TouchableOpacity>
        </View>

        {answer ? <View style={styles.panel}><Text style={styles.sectionTitle}>Response</Text><Text selectable style={styles.answer}>{answer}</Text></View> : null}
        <Text style={styles.status}>{status}</Text>
        <Text style={styles.footer}>Personal AI OS • Android-only • No hosted web dashboard</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#090b12" },
  content: { padding: 18, paddingTop: 36, gap: 15 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  headerCopy: { flex: 1 },
  eyebrow: { color: "#a78bfa", fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: "#f8fafc", fontSize: 27, fontWeight: "800", marginTop: 5 },
  subtitle: { color: "#9ca3af", fontSize: 12, marginTop: 3 },
  settingsButton: { borderWidth: 1, borderColor: "#45405f", backgroundColor: "#211b37", paddingVertical: 11, paddingHorizontal: 13, borderRadius: 12 },
  settingsText: { color: "#e9ddff", fontSize: 12, fontWeight: "800" },
  statsRow: { flexDirection: "row", gap: 10 },
  statCard: { flex: 1, backgroundColor: "#141824", borderColor: "#252b3a", borderWidth: 1, borderRadius: 14, padding: 13, gap: 5 },
  statValue: { color: "#f8fafc", fontSize: 16, fontWeight: "800" },
  statLabel: { color: "#929bad", fontSize: 10 },
  panel: { backgroundColor: "#141824", borderColor: "#252b3a", borderWidth: 1, borderRadius: 18, padding: 15, gap: 12 },
  sectionTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "800" },
  note: { color: "#a1a8b8", fontSize: 11, lineHeight: 17 },
  fieldLabel: { color: "#cbd5e1", fontSize: 12, fontWeight: "700", marginTop: 2 },
  providerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  providerChip: { minWidth: "30%", flexGrow: 1, paddingVertical: 9, paddingHorizontal: 9, borderRadius: 11, borderWidth: 1, borderColor: "#363d50", backgroundColor: "#0e121c", gap: 3 },
  providerActive: { backgroundColor: "#4d348f", borderColor: "#8b72ed" },
  providerText: { color: "#f8fafc", fontSize: 11, fontWeight: "800" },
  providerState: { color: "#a9a2c7", fontSize: 9 },
  input: { backgroundColor: "#0b0f18", borderWidth: 1, borderColor: "#343b4d", color: "#f8fafc", borderRadius: 12, padding: 12, fontSize: 13 },
  messageInput: { minHeight: 125, textAlignVertical: "top" },
  actionRow: { flexDirection: "row", gap: 8 },
  primaryButton: { backgroundColor: "#6848d7", padding: 13, borderRadius: 12, alignItems: "center", justifyContent: "center", flex: 1 },
  secondaryButton: { backgroundColor: "#303747", padding: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#fff", fontWeight: "800", fontSize: 11, textAlign: "center" },
  sendButton: { marginTop: 2 },
  disabled: { opacity: 0.55 },
  modelRow: { paddingVertical: 10, paddingHorizontal: 11, borderRadius: 10, backgroundColor: "#0c111b", borderWidth: 1, borderColor: "#30384a", flexDirection: "row", justifyContent: "space-between", gap: 8 },
  modelActive: { borderColor: "#9275ef", backgroundColor: "#211b37" },
  modelText: { color: "#e5e7eb", fontSize: 11, flex: 1 },
  modelMark: { color: "#b8a4ff", fontSize: 10, fontWeight: "700" },
  answer: { color: "#e5e7eb", fontSize: 13, lineHeight: 21 },
  status: { color: "#a78bfa", fontSize: 11, textAlign: "center" },
  footer: { color: "#687184", textAlign: "center", fontSize: 10, marginVertical: 8 },
});
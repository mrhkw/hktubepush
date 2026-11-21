import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";

type Provider = "openai" | "gemini" | "anthropic" | "deepseek";
type ProviderConfig = { label: string; model: string; keyName: string };
const PROVIDERS: Record<Provider, ProviderConfig> = {
  openai: { label: "OpenAI", model: "gpt-4.1-mini", keyName: "OPENAI_API_KEY" },
  gemini: { label: "Gemini", model: "gemini-2.5-flash", keyName: "GEMINI_API_KEY" },
  anthropic: { label: "Claude", model: "claude-3-5-haiku-latest", keyName: "ANTHROPIC_API_KEY" },
  deepseek: { label: "DeepSeek", model: "deepseek-chat", keyName: "DEEPSEEK_API_KEY" },
};
const KEY_PREFIX = "pa_ios_provider_";
const MAX_MESSAGE_LENGTH = 20000;

async function askProvider(provider: Provider, apiKey: string, message: string): Promise<string> {
  const model = PROVIDERS[provider].model;
  let response: Response;
  if (provider === "openai" || provider === "deepseek") {
    const endpoint = provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.deepseek.com/chat/completions";
    response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages: [{ role: "user", content: message }], temperature: 0.4 }) });
    const data: unknown = await response.json();
    if (!response.ok) throw new Error(readError(data));
    return readOpenAIText(data);
  }
  if (provider === "gemini") {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify({ contents: [{ parts: [{ text: message }] }] }) });
    const data: unknown = await response.json();
    if (!response.ok) throw new Error(readError(data));
    return readGeminiText(data);
  }
  response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 2048, messages: [{ role: "user", content: message }] }) });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(readError(data));
  return readAnthropicText(data);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function readError(value: unknown): string {
  if (isRecord(value) && isRecord(value.error) && typeof value.error.message === "string") return value.error.message;
  if (isRecord(value) && typeof value.message === "string") return value.message;
  return "Provider request failed. Check API key, model access and usage limits.";
}
function readOpenAIText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices)) throw new Error("Unexpected OpenAI-compatible response.");
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== "string") throw new Error("Provider returned no text.");
  return first.message.content;
}
function readGeminiText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.candidates)) throw new Error("Unexpected Gemini response.");
  const first = value.candidates[0];
  if (!isRecord(first) || !isRecord(first.content) || !Array.isArray(first.content.parts)) throw new Error("Gemini returned no text.");
  return first.content.parts.map((part: unknown) => isRecord(part) && typeof part.text === "string" ? part.text : "").join("");
}
function readAnthropicText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.content)) throw new Error("Unexpected Claude response.");
  return value.content.map((part: unknown) => isRecord(part) && typeof part.text === "string" ? part.text : "").join("");
}

export default function App(): React.JSX.Element {
  const [provider, setProvider] = useState<Provider>("gemini");
  const [keys, setKeys] = useState<Record<Provider, string>>({ openai: "", gemini: "", anthropic: "", deepseek: "" });
  const [keyInput, setKeyInput] = useState("");
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all((Object.keys(PROVIDERS) as Provider[]).map(async (name) => [name, await SecureStore.getItemAsync(KEY_PREFIX + name)] as const)).then((entries) => {
      if (!active) return;
      const loaded: Record<Provider, string> = { openai: "", gemini: "", anthropic: "", deepseek: "" };
      entries.forEach(([name, value]) => { loaded[name] = value ?? ""; });
      setKeys(loaded);
    }).catch(() => Alert.alert("Storage error", "Secure key storage could not be opened on this device."));
    return () => { active = false; };
  }, []);

  useEffect(() => { setKeyInput(keys[provider]); }, [provider, keys]);

  async function saveKey(): Promise<void> {
    const value = keyInput.trim();
    try {
      if (value) await SecureStore.setItemAsync(KEY_PREFIX + provider, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      else await SecureStore.deleteItemAsync(KEY_PREFIX + provider);
      setKeys((current) => ({ ...current, [provider]: value }));
      Alert.alert("Saved", PROVIDERS[provider].label + " key saved in Android secure storage.");
    } catch { Alert.alert("Save failed", "Android secure storage could not save this key."); }
  }

  async function send(): Promise<void> {
    const prompt = message.trim();
    if (!prompt) { Alert.alert("Message required", "Enter a message first."); return; }
    if (prompt.length > MAX_MESSAGE_LENGTH) { Alert.alert("Message too long", "Maximum message length is 20,000 characters."); return; }
    const apiKey = keys[provider].trim();
    if (!apiKey) { setShowSettings(true); Alert.alert("API key missing", "Save a " + PROVIDERS[provider].label + " API key in Settings."); return; }
    setBusy(true); setAnswer("");
    try { setAnswer(await askProvider(provider, apiKey, prompt)); }
    catch (error) { setAnswer("Error: " + (error instanceof Error ? error.message : "Unknown provider error.")); }
    finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View><Text style={styles.eyebrow}>PRIVATE • DEVICE-ONLY</Text><Text style={styles.title}>Personal AI OS</Text><Text style={styles.subtitle}>Your personal AI workspace</Text></View>
          <TouchableOpacity style={styles.settingsButton} onPress={() => setShowSettings(!showSettings)}><Text style={styles.settingsText}>Settings</Text></TouchableOpacity>
        </View>
        {showSettings ? <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Provider API keys</Text>
          <Text style={styles.note}>Keys are stored using Android secure storage and are not uploaded to our server. Direct provider requests may expose a key to a compromised device or modified app.</Text>
          <View style={styles.providerRow}>{(Object.keys(PROVIDERS) as Provider[]).map((name) => <TouchableOpacity key={name} onPress={() => setProvider(name)} style={[styles.providerChip, provider === name && styles.providerActive]}><Text style={styles.providerText}>{PROVIDERS[name].label}</Text></TouchableOpacity>)}</View>
          <Text style={styles.fieldLabel}>{PROVIDERS[provider].label} API key</Text>
          <TextInput value={keyInput} onChangeText={setKeyInput} placeholder="Paste API key" placeholderTextColor="#7b8191" secureTextEntry autoCapitalize="none" autoCorrect={false} style={styles.input} />
          <View style={styles.actionRow}><TouchableOpacity style={styles.primaryButton} onPress={() => void saveKey()}><Text style={styles.buttonText}>Save key</Text></TouchableOpacity><TouchableOpacity style={styles.secondaryButton} onPress={() => { setKeyInput(""); void SecureStore.deleteItemAsync(KEY_PREFIX + provider).then(() => setKeys((current) => ({ ...current, [provider]: "" }))); }}><Text style={styles.buttonText}>Remove</Text></TouchableOpacity></View>
          <Text style={styles.note}>Default model: {PROVIDERS[provider].model}. Provider API charges, quotas and account rules are separate.</Text>
        </View> : null}
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>New conversation</Text>
          <Text style={styles.fieldLabel}>AI provider</Text>
          <View style={styles.providerRow}>{(Object.keys(PROVIDERS) as Provider[]).map((name) => <TouchableOpacity key={name} onPress={() => setProvider(name)} style={[styles.providerChip, provider === name && styles.providerActive]}><Text style={styles.providerText}>{PROVIDERS[name].label}</Text></TouchableOpacity>)}</View>
          <Text style={styles.fieldLabel}>Message</Text>
          <TextInput value={message} onChangeText={setMessage} placeholder="What do you want your AI to do?" placeholderTextColor="#7b8191" multiline maxLength={MAX_MESSAGE_LENGTH} style={[styles.input, styles.messageInput]} />
          <TouchableOpacity disabled={busy} onPress={() => void send()} style={[styles.primaryButton, styles.sendButton, busy && styles.disabled]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send message</Text>}</TouchableOpacity>
        </View>
        {answer ? <View style={styles.panel}><Text style={styles.sectionTitle}>Response</Text><Text selectable style={styles.answer}>{answer}</Text></View> : null}
        <Text style={styles.footer}>Personal AI OS • Android app • No web dashboard</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#090b12" },
  content: { padding: 20, paddingTop: 38, gap: 18 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  eyebrow: { color: "#a78bfa", fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  title: { color: "#f8fafc", fontSize: 29, fontWeight: "800", marginTop: 6 },
  subtitle: { color: "#9ca3af", fontSize: 14, marginTop: 4 },
  settingsButton: { borderWidth: 1, borderColor: "#343849", paddingVertical: 10, paddingHorizontal: 13, borderRadius: 12 },
  settingsText: { color: "#e5e7eb", fontWeight: "700" },
  panel: { backgroundColor: "#141824", borderColor: "#252b3a", borderWidth: 1, borderRadius: 18, padding: 16, gap: 13 },
  sectionTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "800" },
  note: { color: "#a1a8b8", fontSize: 12, lineHeight: 18 },
  fieldLabel: { color: "#cbd5e1", fontSize: 13, fontWeight: "700", marginTop: 3 },
  providerRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  providerChip: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: "#363d50", backgroundColor: "#0e121c" },
  providerActive: { backgroundColor: "#5b3cc4", borderColor: "#8b72ed" },
  providerText: { color: "#f8fafc", fontSize: 12, fontWeight: "700" },
  input: { backgroundColor: "#0b0f18", borderWidth: 1, borderColor: "#343b4d", color: "#f8fafc", borderRadius: 12, padding: 13, fontSize: 14 },
  messageInput: { minHeight: 130, textAlignVertical: "top" },
  actionRow: { flexDirection: "row", gap: 10 },
  primaryButton: { backgroundColor: "#6848d7", padding: 14, borderRadius: 12, alignItems: "center", justifyContent: "center", flex: 1 },
  secondaryButton: { backgroundColor: "#303747", padding: 14, borderRadius: 12, alignItems: "center", justifyContent: "center", flex: 1 },
  sendButton: { marginTop: 3 },
  disabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  answer: { color: "#e5e7eb", fontSize: 14, lineHeight: 22 },
  footer: { color: "#687184", textAlign: "center", fontSize: 11, marginVertical: 12 },
});

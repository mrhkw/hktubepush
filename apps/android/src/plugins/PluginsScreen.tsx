import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

export type PluginCategory = "Productivity" | "Files & Data" | "Developer Tools" | "Communication" | "Research" | "Creative Studio" | "Automation";
export type PluginDefinition = {
  id: string;
  name: string;
  description: string;
  category: PluginCategory;
  kind: "built-in" | "connector";
  auth: "none" | "token";
  scopes: string[];
  setup: string;
};

export const PLUGINS: PluginDefinition[] = [
  { id: "file-tools", name: "File Tools", description: "Select and analyze documents stored on your device", category: "Files & Data", kind: "built-in", auth: "none", scopes: ["Read files you select"], setup: "No account required. File access is requested only when you choose a file." },
  { id: "coding-studio", name: "Coding Studio", description: "Create, review and explain code projects", category: "Creative Studio", kind: "built-in", auth: "none", scopes: ["Read code you select", "Create local project drafts"], setup: "Local workspace. Code execution is not enabled in this release." },
  { id: "design-studio", name: "Design Studio", description: "Generate design briefs, layouts and UI specifications", category: "Creative Studio", kind: "built-in", auth: "none", scopes: ["Create local design drafts"], setup: "Uses your selected AI provider. Export tools are being added." },
  { id: "workflow-automation", name: "Workflow Automation", description: "Build repeatable AI workflows with approval steps", category: "Automation", kind: "built-in", auth: "none", scopes: ["Save workflows locally", "Run enabled prompt steps"], setup: "Workflows run on this device. External actions require a connected service and approval." },
  { id: "web-search", name: "Web Search", description: "Search the web and summarize public pages", category: "Research", kind: "connector", auth: "token", scopes: ["Send search queries to search provider"], setup: "Add a supported search API token. Search provider integration must be configured separately." },
  { id: "github", name: "GitHub", description: "Read repositories, issues, pull requests and commits", category: "Developer Tools", kind: "connector", auth: "token", scopes: ["Read repositories", "Read issues and pull requests"], setup: "Create a fine-grained token with read-only repository permissions unless write access is genuinely needed." },
  { id: "vercel", name: "Vercel", description: "Inspect projects and deployment status", category: "Developer Tools", kind: "connector", auth: "token", scopes: ["Read projects", "Read deployments"], setup: "Use a Vercel access token with the minimum required permissions." },
  { id: "supabase", name: "Supabase", description: "Inspect and manage your Supabase project", category: "Developer Tools", kind: "connector", auth: "token", scopes: ["Access the project URL you provide", "API access follows the supplied key's permissions"], setup: "Provide your project URL and a restricted key. Never use a service-role key in a mobile app." },
  { id: "notion", name: "Notion", description: "Search and manage pages and databases", category: "Productivity", kind: "connector", auth: "token", scopes: ["Access pages shared with the integration"], setup: "Create a Notion integration and explicitly share only the pages it should access." },
  { id: "slack", name: "Slack", description: "Search messages and work with permitted channels", category: "Communication", kind: "connector", auth: "token", scopes: ["Access only scopes granted to the token"], setup: "Use a Slack app token with the minimum scopes. OAuth installation is not included yet." },
  { id: "dropbox", name: "Dropbox", description: "Access files and folders allowed by your token", category: "Files & Data", kind: "connector", auth: "token", scopes: ["Read files allowed by token"], setup: "Use an app-scoped token. OAuth sign-in is not included yet." },
  { id: "google-drive", name: "Google Drive", description: "Find and read files in your Drive", category: "Files & Data", kind: "connector", auth: "token", scopes: ["Read files allowed by Google authorization"], setup: "OAuth consent and Google verification are required before live Drive access." },
  { id: "google-calendar", name: "Google Calendar", description: "View and manage calendar events", category: "Productivity", kind: "connector", auth: "token", scopes: ["Calendar access granted to the token"], setup: "OAuth consent is required before live Calendar access." },
  { id: "gmail", name: "Gmail", description: "Search and organize email", category: "Communication", kind: "connector", auth: "token", scopes: ["Mail access granted to the token"], setup: "OAuth consent and restricted-scope verification may be required before live Gmail access." },
  { id: "linear", name: "Linear", description: "Read and update issues and projects", category: "Productivity", kind: "connector", auth: "token", scopes: ["Workspace access granted to the token"], setup: "Use a Linear API key with limited workspace access." },
  { id: "tinyfish", name: "TinyFish Browser Agent", description: "Run browser tasks on supported websites", category: "Research", kind: "connector", auth: "token", scopes: ["Browser actions are limited by connected account permissions"], setup: "Requires a TinyFish account/API token and a separately configured secure execution service." },
  { id: "cloudflare", name: "Cloudflare", description: "Inspect account resources and Workers AI", category: "Developer Tools", kind: "connector", auth: "token", scopes: ["Access only resources allowed by API token"], setup: "Use a scoped API token and your Cloudflare Account ID." },
  { id: "openrouter", name: "OpenRouter", description: "Use models from multiple AI providers", category: "Research", kind: "connector", auth: "token", scopes: ["Send prompts to selected models"], setup: "Configure the OpenRouter key in API Manager. This plugin shares that provider credential." },
  { id: "calendar-local", name: "Local Reminders", description: "Create and review reminders on this device", category: "Productivity", kind: "built-in", auth: "none", scopes: ["Create local reminders"], setup: "Local-only reminders. Notification permission will be requested when reminders are enabled." },
  { id: "clipboard", name: "Clipboard Tools", description: "Use text you explicitly copy into the assistant", category: "Productivity", kind: "built-in", auth: "none", scopes: ["Read clipboard only after user action"], setup: "Clipboard access is user-triggered, not continuous." }
];

const ENABLED_KEY = "paios_plugins_enabled_v1";
const secretKey = (id: string): string => "paios_plugin_secret_" + id;

export async function loadEnabledPlugins(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(ENABLED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && PLUGINS.some((plugin) => plugin.id === id)) : [];
  } catch {
    return [];
  }
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  if (!PLUGINS.some((plugin) => plugin.id === id)) throw new Error("Unknown plugin.");
  const current = await loadEnabledPlugins();
  const next = enabled ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id);
  await AsyncStorage.setItem(ENABLED_KEY, JSON.stringify(next));
}

export async function savePluginToken(id: string, token: string): Promise<void> {
  if (!PLUGINS.some((plugin) => plugin.id === id) || !token.trim() || token.length > 4096) throw new Error("Invalid plugin credential.");
  await SecureStore.setItemAsync(secretKey(id), token.trim());
}

export async function removePluginToken(id: string): Promise<void> {
  await SecureStore.deleteItemAsync(secretKey(id));
}

export async function hasPluginToken(id: string): Promise<boolean> {
  return Boolean(await SecureStore.getItemAsync(secretKey(id)));
}

type Props = { onBack: () => void };

export default function PluginsScreen({ onBack }: Props): React.JSX.Element {
  const [enabled, setEnabled] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("github");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"All" | PluginCategory>("All");
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Plugins are off until you add them.");
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([loadEnabledPlugins(), Promise.all(PLUGINS.filter((p) => p.auth === "token").map(async (p) => [p.id, await hasPluginToken(p.id)] as const))]).then(([ids, credentials]) => {
      if (!active) return;
      setEnabled(ids);
      setHasToken(Object.fromEntries(credentials));
    });
    return () => { active = false; };
  }, []);

  const current = PLUGINS.find((plugin) => plugin.id === selected) ?? PLUGINS[0];
  const categories = useMemo(() => ["All", ...Array.from(new Set(PLUGINS.map((plugin) => plugin.category)))], []);
  const visible = useMemo(() => PLUGINS.filter((plugin) => (category === "All" || plugin.category === category) && (plugin.name + " " + plugin.description).toLowerCase().includes(search.trim().toLowerCase())), [category, search]);
  const isEnabled = enabled.includes(current.id);

  async function toggle(plugin: PluginDefinition): Promise<void> {
    setBusy(true);
    try {
      const next = !enabled.includes(plugin.id);
      if (next && plugin.auth === "token" && !hasToken[plugin.id] && plugin.id !== "openrouter") {
        setSelected(plugin.id);
        setShowDetails(true);
        setNotice("Add this connector's credential before enabling it.");
        return;
      }
      await setPluginEnabled(plugin.id, next);
      setEnabled((old) => next ? [...old, plugin.id] : old.filter((id) => id !== plugin.id));
      setNotice(next ? plugin.name + " added to your workspace." : plugin.name + " removed from your workspace.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Plugin setting could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCredential(): Promise<void> {
    setBusy(true);
    try {
      await savePluginToken(current.id, token);
      setHasToken((old) => ({ ...old, [current.id]: true }));
      setToken("");
      await setPluginEnabled(current.id, true);
      setEnabled((old) => Array.from(new Set([...old, current.id])));
      setNotice(current.name + " credential saved securely and plugin added.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Credential could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    setBusy(true);
    try {
      await removePluginToken(current.id);
      await setPluginEnabled(current.id, false);
      setHasToken((old) => ({ ...old, [current.id]: false }));
      setEnabled((old) => old.filter((id) => id !== current.id));
      setToken("");
      setNotice(current.name + " disconnected and credential removed from this device.");
    } catch {
      setNotice("Could not disconnect this plugin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.back}><Text style={styles.backText}>‹ Back</Text></TouchableOpacity>
        <View style={styles.heading}><Text style={styles.title}>Plugins & Connectors</Text><Text style={styles.subtitle}>{enabled.length} added · {PLUGINS.length} available</Text></View>
      </View>
      <TextInput value={search} onChangeText={setSearch} placeholder="Search plugins" placeholderTextColor="#7b8191" style={styles.search} autoCapitalize="none" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>
        {categories.map((item) => <TouchableOpacity key={item} onPress={() => setCategory(item as "All" | PluginCategory)} style={[styles.category, category === item && styles.categoryActive]}><Text style={styles.categoryText}>{item}</Text></TouchableOpacity>)}
      </ScrollView>
      <View style={styles.body}>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {visible.map((plugin) => (
            <TouchableOpacity key={plugin.id} onPress={() => { setSelected(plugin.id); setShowDetails(true); }} style={[styles.pluginRow, selected === plugin.id && styles.pluginSelected]}>
              <View style={styles.pluginIcon}><Text style={styles.pluginInitial}>{plugin.name.slice(0, 1)}</Text></View>
              <View style={styles.pluginCopy}><Text style={styles.pluginName}>{plugin.name}</Text><Text style={styles.pluginDescription} numberOfLines={2}>{plugin.description}</Text><Text style={styles.pluginMeta}>{plugin.category} · {enabled.includes(plugin.id) ? "Added" : plugin.kind === "built-in" ? "Built-in" : "Connector"}</Text></View>
              <Text style={styles.add}>{enabled.includes(plugin.id) ? "✓" : "+"}</Text>
            </TouchableOpacity>
          ))}
          {!visible.length ? <Text style={styles.empty}>No plugins match this search.</Text> : null}
        </ScrollView>
        {showDetails ? (
          <View style={styles.details}>
            <ScrollView contentContainerStyle={styles.detailsContent}>
              <Text style={styles.detailTitle}>{current.name}</Text>
              <Text style={styles.detailDescription}>{current.description}</Text>
              <Text style={styles.detailLabel}>Access requested</Text>
              {current.scopes.map((scope) => <Text key={scope} style={styles.scope}>• {scope}</Text>)}
              <Text style={styles.setup}>{current.setup}</Text>
              {current.auth === "token" && current.id !== "openrouter" ? (
                <>
                  <Text style={styles.detailLabel}>{hasToken[current.id] ? "Credential saved on this device" : "API token / access key"}</Text>
                  <TextInput value={token} onChangeText={setToken} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="Paste credential" placeholderTextColor="#7b8191" style={styles.tokenInput} />
                  <TouchableOpacity disabled={busy || !token.trim()} onPress={() => void saveCredential()} style={[styles.primary, (!token.trim() || busy) && styles.disabled]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save securely & Add plugin</Text>}</TouchableOpacity>
                  {hasToken[current.id] ? <TouchableOpacity disabled={busy} onPress={() => void disconnect()} style={styles.disconnect}><Text style={styles.disconnectText}>Disconnect and delete credential</Text></TouchableOpacity> : null}
                </>
              ) : (
                <TouchableOpacity disabled={busy} onPress={() => void toggle(current)} style={styles.primary}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{isEnabled ? "Remove plugin" : "Add plugin"}</Text>}</TouchableOpacity>
              )}
              {current.auth === "token" && current.id === "openrouter" ? <Text style={styles.setup}>Uses the OpenRouter key saved in API Manager. Enable it there after configuring the provider.</Text> : null}
              <TouchableOpacity onPress={() => setShowDetails(false)} style={styles.close}><Text style={styles.closeText}>Close details</Text></TouchableOpacity>
            </ScrollView>
          </View>
        ) : null}
      </View>
      <Text style={styles.notice}>{notice}</Text>
      <Text style={styles.footnote}>Only selected plugins are enabled. Credentials are stored in Android SecureStore, not in GitHub.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#090b12", paddingTop: 34, paddingHorizontal: 14, paddingBottom: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  back: { paddingVertical: 8, paddingRight: 5 },
  backText: { color: "#c4b5fd", fontSize: 13, fontWeight: "700" },
  heading: { flex: 1 },
  title: { color: "#f8fafc", fontSize: 20, fontWeight: "800" },
  subtitle: { color: "#9ca3af", fontSize: 11, marginTop: 3 },
  search: { backgroundColor: "#141824", borderColor: "#343b4d", borderWidth: 1, color: "#fff", borderRadius: 13, padding: 12, fontSize: 13 },
  categories: { gap: 7, paddingVertical: 12 },
  category: { borderWidth: 1, borderColor: "#363d50", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "#111621" },
  categoryActive: { backgroundColor: "#4d348f", borderColor: "#8b72ed" },
  categoryText: { color: "#e5e7eb", fontSize: 10, fontWeight: "700" },
  body: { flex: 1, flexDirection: "row", gap: 9 },
  list: { flex: 1 },
  listContent: { gap: 7, paddingBottom: 12 },
  pluginRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#141824", borderWidth: 1, borderColor: "#252b3a", borderRadius: 12, padding: 9 },
  pluginSelected: { borderColor: "#8b72ed", backgroundColor: "#211b37" },
  pluginIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: "#2d2450", alignItems: "center", justifyContent: "center" },
  pluginInitial: { color: "#d8ccff", fontSize: 16, fontWeight: "800" },
  pluginCopy: { flex: 1 },
  pluginName: { color: "#f8fafc", fontSize: 11, fontWeight: "800" },
  pluginDescription: { color: "#a1a8b8", fontSize: 9, lineHeight: 13, marginTop: 2 },
  pluginMeta: { color: "#a78bfa", fontSize: 8, marginTop: 3 },
  add: { color: "#c4b5fd", fontSize: 22, paddingHorizontal: 4 },
  empty: { color: "#9ca3af", fontSize: 12, padding: 12 },
  details: { width: "48%", backgroundColor: "#141824", borderRadius: 13, borderWidth: 1, borderColor: "#343b4d" },
  detailsContent: { padding: 11, gap: 9 },
  detailTitle: { color: "#f8fafc", fontSize: 15, fontWeight: "800" },
  detailDescription: { color: "#cbd5e1", fontSize: 10, lineHeight: 15 },
  detailLabel: { color: "#c4b5fd", fontSize: 10, fontWeight: "800", marginTop: 5 },
  scope: { color: "#d1d5db", fontSize: 9, lineHeight: 13 },
  setup: { color: "#a1a8b8", fontSize: 9, lineHeight: 14 },
  tokenInput: { backgroundColor: "#0b0f18", borderWidth: 1, borderColor: "#343b4d", color: "#fff", borderRadius: 9, padding: 9, fontSize: 10 },
  primary: { backgroundColor: "#6848d7", padding: 11, borderRadius: 10, alignItems: "center", justifyContent: "center", minHeight: 38 },
  primaryText: { color: "#fff", fontSize: 10, fontWeight: "800", textAlign: "center" },
  disabled: { opacity: 0.5 },
  disconnect: { padding: 8, alignItems: "center" },
  disconnectText: { color: "#fca5a5", fontSize: 9, fontWeight: "700", textAlign: "center" },
  close: { paddingVertical: 8, alignItems: "center" },
  closeText: { color: "#c4b5fd", fontSize: 10, fontWeight: "700" },
  notice: { color: "#a78bfa", fontSize: 10, textAlign: "center", paddingTop: 8 },
  footnote: { color: "#687184", fontSize: 8, textAlign: "center", paddingTop: 5 }
});

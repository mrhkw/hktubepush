export type Provider = "openai" | "gemini" | "groq";
export type Attachment = { name: string; mimeType: string; dataBase64: string; sizeBytes: number };
export type Credentials = Partial<Record<Provider, { apiKey: string; model?: string }>>;
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type AgentEvent = { type: string; stepId?: string; data?: any };

export type AgentConfig = {
  baseUrl: string;
  backendSecret?: string;
  credentials: Credentials;
  githubToken?: string;
  webhookAllowlist?: string[];
};
export type GithubRepository = { id: number; full_name: string; name: string; owner?: { login: string }; default_branch?: string; private?: boolean };
export type GithubTreeEntry = { path: string; type: "blob" | "tree"; size?: number };

const cleanBase = (baseUrl: string) => baseUrl.trim().replace(/\/$/, "");
const requireBaseUrl = (baseUrl: string) => { const value = cleanBase(baseUrl); if (!value) throw new Error("Backend URL is not configured. Open Settings, enter your HTTPS backend URL, and press Save."); return value; };
const headers = (config: AgentConfig) => ({ "content-type": "application/json", ...(config.backendSecret ? { "x-agent-secret": config.backendSecret } : {}) });
const request = async <T>(config: AgentConfig, path: string, body: unknown): Promise<T> => {
  const baseUrl = requireBaseUrl(config.baseUrl);
  try {
    const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: headers(config), body: JSON.stringify(body) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error ?? `Backend request failed (${response.status})`);
    return json as T;
  } catch (error) { if (error instanceof Error && !/Network request failed|Failed to fetch/.test(error.message)) throw error; throw new Error(`Could not reach the backend at ${baseUrl}. Check the URL, HTTPS certificate, and network connection.`); }
};

export const chat = (config: AgentConfig, input: { messages: ChatMessage[]; provider: Provider; systemPrompt?: string; attachments?: Attachment[] }) => request<{ provider: Provider; model: string; text: string }>(config, "/v1/chat", { ...input, credentials: config.credentials, taskType: input.attachments?.length ? "multimodal" : "chat" });

const parseSse = (lineBuffer: string, onEvent: (event: any) => void) => {
  const chunks = lineBuffer.split(/\r?\n\r?\n/);
  const remainder = chunks.pop() ?? "";
  for (const chunk of chunks) {
    const line = chunk.split(/\r?\n/).find(item => item.startsWith("data:"));
    if (!line) continue;
    try { onEvent(JSON.parse(line.slice(5).trim())); } catch { /* ignore malformed partial event */ }
  }
  return remainder;
};

export const streamChat = async (config: AgentConfig, input: { messages: ChatMessage[]; provider: Provider; systemPrompt?: string; attachments?: Attachment[] }, onEvent: (event: any) => void) => {
  const baseUrl = requireBaseUrl(config.baseUrl);
  let response: Response;
  try { response = await fetch(`${baseUrl}/v1/chat/stream`, { method: "POST", headers: headers(config), body: JSON.stringify({ ...input, stream: true, credentials: config.credentials, taskType: input.attachments?.length ? "multimodal" : "chat" }) }); }
  catch { throw new Error(`Could not reach the backend at ${baseUrl}. Check the URL, HTTPS certificate, and network connection.`); }
  if (!response.ok) throw new Error(`Chat request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  if (!response.body?.getReader) { onEvent(await response.json()); return; }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer = parseSse(buffer + decoder.decode(value, { stream: true }), onEvent);
  }
  if (buffer.trim()) parseSse(`${buffer}\n\n`, onEvent);
};

export const planAgent = (config: AgentConfig, goal: string) => request<{ steps: any[] }>(config, "/v1/agent/plan", { goal });
export const runAgent = async (config: AgentConfig, goal: string, onEvent: (event: AgentEvent) => void, approvedActionIds: string[] = []) => {
  const baseUrl = requireBaseUrl(config.baseUrl);
  let response: Response;
  try { response = await fetch(`${baseUrl}/v1/agent/run`, { method: "POST", headers: headers(config), body: JSON.stringify({ goal, credentials: config.credentials, githubToken: config.githubToken, webhookAllowlist: config.webhookAllowlist, approvedActionIds, taskType: "agent" }) }); }
  catch { throw new Error(`Could not reach the backend at ${baseUrl}. Check the URL, HTTPS certificate, and network connection.`); }
  if (!response.ok) throw new Error(`Agent request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Streaming is not supported by this device");
  const decoder = new TextDecoder(); let buffer = "";
  while (true) { const { done, value } = await reader.read(); if (done) break; buffer = parseSse(buffer + decoder.decode(value, { stream: true }), onEvent); }
  if (buffer.trim()) parseSse(`${buffer}\n\n`, onEvent);
};
export const approveAgentAction = (config: AgentConfig, approvalId: string, approvalToken: string) => request<{ ok: true; approvedActionId: string }>(config, "/v1/agent/approve", { approvalId, approvalToken });
export const inspectFile = (config: AgentConfig, attachment: Attachment) => request<any>(config, "/v1/files/inspect", { attachment });
export const githubRepositories = (config: AgentConfig) => request<GithubRepository[]>(config, "/v1/github/repositories", { githubToken: config.githubToken });
export const githubTree = (config: AgentConfig, input: { owner: string; repo: string; branch: string }) => request<{ tree: GithubTreeEntry[] }>(config, "/v1/github/tree", { ...input, githubToken: config.githubToken });
export const githubFile = (config: AgentConfig, input: { owner: string; repo: string; path: string; branch: string }) => request<{ path: string; sha: string; content: string }>(config, "/v1/github/file", { ...input, githubToken: config.githubToken });
export const githubCommitFile = (config: AgentConfig, input: { owner: string; repo: string; path: string; branch: string; content: string; message: string }) => request<any>(config, "/v1/github/commit-file", { ...input, githubToken: config.githubToken });

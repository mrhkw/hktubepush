export type ProviderName = "openai" | "gemini" | "groq";
export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ProviderCredentials {
  openai?: { apiKey: string; baseUrl?: string; model?: string };
  gemini?: { apiKey: string; baseUrl?: string; model?: string };
  groq?: { apiKey: string; baseUrl?: string; model?: string };
}

export interface Attachment {
  name: string;
  mimeType: string;
  dataBase64: string;
  sizeBytes?: number;
}

export interface ChatMessage {
  role: ChatRole;
  content: string | Array<{ type: "text" | "image_url" | "input_audio" | "inline_data"; text?: string; image_url?: { url: string }; input_audio?: { data: string; format: string }; inline_data?: { mime_type: string; data: string } }>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  provider?: ProviderName | "auto";
  credentials?: ProviderCredentials;
  systemPrompt?: string;
  attachments?: Attachment[];
  taskType?: "chat" | "code" | "research" | "multimodal" | "agent";
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResult {
  provider: ProviderName;
  model: string;
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

export interface AgentRequest extends Omit<ChatRequest, "stream"> {
  goal: string;
  approvedActionIds?: string[];
  maxSteps?: number;
  githubToken?: string;
  webhookAllowlist?: string[];
  manualPlugins?: ManualPlugin[];
}

export type ManualPluginAuth = "none" | "bearer" | "api_key" | "basic";
export interface ManualPlugin {
  id: string;
  name: string;
  baseUrl: string;
  auth: ManualPluginAuth;
  secret?: string;
  headerName?: string;
  username?: string;
  password?: string;
  allowedHosts?: string[];
  enabled?: boolean;
}

export type ToolName = "web_search" | "web_fetch" | "github" | "webhook" | "mcp" | "manual_plugin";
export interface ToolCall {
  name: ToolName;
  input: Record<string, unknown>;
  reason: string;
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  tool?: ToolName;
  input?: Record<string, unknown>;
  risky: boolean;
}

export interface ApprovalRequest {
  id: string;
  action: string;
  tool: ToolName;
  input: Record<string, unknown>;
  reason: string;
  expiresAt: string;
}

export interface AgentEvent {
  type: "plan" | "step_started" | "step_completed" | "approval_required" | "message" | "error" | "done";
  stepId?: string;
  data: unknown;
}

export interface FileInspection {
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: "text" | "image" | "audio" | "video" | "binary";
  text?: string;
  sha256: string;
}

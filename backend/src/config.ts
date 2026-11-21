const numberEnv = (name: string, fallback: number, min: number, max: number) => {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export const config = {
  port: numberEnv("PORT", 8787, 1, 65535),
  maxBodyBytes: numberEnv("MAX_BODY_BYTES", 10 * 1024 * 1024, 1024, 50 * 1024 * 1024),
  requestTimeoutMs: numberEnv("REQUEST_TIMEOUT_MS", 30_000, 2_000, 120_000),
  maxAgentSteps: numberEnv("AGENT_MAX_STEPS", 8, 1, 20),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:8081,http://localhost:5173").split(",").map(value => value.trim()).filter(Boolean),
  providers: {
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    geminiBaseUrl: process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta",
    groqBaseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
    openaiDefaultModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    geminiDefaultModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    groqDefaultModel: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
  },
};

export const providerKey = (name: "openai" | "gemini" | "groq", requestKey?: string) => {
  const normalized = requestKey?.trim();
  if (normalized) return normalized;
  const envName = `${name.toUpperCase()}_API_KEY`;
  return process.env[envName]?.trim() || undefined;
};

export const assertNonEmptyString = (value: unknown, field: string, max = 50_000): string => {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new Error(`Invalid ${field}`);
  return value.trim();
};

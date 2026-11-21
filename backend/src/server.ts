import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config.js";
import { runAgent, createPlan, consumeApproval } from "./agent.js";
import { inspectAttachment } from "./files.js";
import { chat, streamChat } from "./providers.js";
import { redactSecrets } from "./security.js";
import { githubCommitFile, githubListRepositories, githubListTree, githubReadFile } from "./connectors.js";
import type { AgentRequest, ChatRequest } from "./types.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: config.maxBodyBytes }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !config.corsOrigins.includes(origin)) return res.status(403).json({ error: "Origin is not allowed" });
  if (origin) res.setHeader("access-control-allow-origin", origin);
  res.setHeader("access-control-allow-headers", "content-type,x-agent-secret");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const authGuard = (req: Request, res: Response, next: NextFunction) => {
  const expected = process.env.BACKEND_SHARED_SECRET?.trim();
  if (expected && req.header("x-agent-secret") !== expected) return res.status(401).json({ error: "Backend authentication required" });
  next();
};
app.use("/v1", authGuard);

const asyncRoute = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { void handler(req, res).catch(next); };
const body = <T>(req: Request) => (req.body ?? {}) as T;
const sse = (res: Response) => { res.status(200).set({ "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" }).flushHeaders(); };
const sendEvent = (res: Response, event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);

app.get("/health", (_req, res) => res.json({ ok: true, service: "hktube-autonomous-agent-backend", phase: 1, timestamp: new Date().toISOString() }));
app.post("/v1/chat", asyncRoute(async (req, res) => {
  const request = body<ChatRequest>(req);
  const result = await chat({ ...request, stream: false });
  res.json(result);
}));
app.post("/v1/chat/stream", asyncRoute(async (req, res) => {
  const request = body<ChatRequest>(req);
  sse(res);
  try { for await (const event of streamChat({ ...request, stream: true })) sendEvent(res, event); } catch (error) { sendEvent(res, { type: "error", error: redactSecrets(error instanceof Error ? error.message : "Stream failed") }); }
  res.end();
}));
app.post("/v1/agent/plan", asyncRoute(async (req, res) => {
  const request = body<Pick<AgentRequest, "goal" | "maxSteps">>(req);
  if (typeof request.goal !== "string" || !request.goal.trim()) return void res.status(400).json({ error: "goal is required" });
  res.json({ goal: request.goal, steps: createPlan(request.goal).slice(0, request.maxSteps ?? config.maxAgentSteps) });
}));
app.post("/v1/agent/run", asyncRoute(async (req, res) => {
  const request = body<AgentRequest>(req);
  if (typeof request.goal !== "string" || !request.goal.trim()) return void res.status(400).json({ error: "goal is required" });
  sse(res);
  try { for await (const event of runAgent(request)) sendEvent(res, redactSecrets(event)); } catch (error) { sendEvent(res, { type: "error", data: redactSecrets(error instanceof Error ? error.message : "Agent failed") }); }
  res.end();
}));
app.post("/v1/agent/approve", asyncRoute(async (req, res) => {
  const { approvalId, approvalToken } = body<{ approvalId?: string; approvalToken?: string }>(req);
  if (!approvalId || !approvalToken) return void res.status(400).json({ error: "approvalId and approvalToken are required" });
  const approval = consumeApproval(approvalId, approvalToken);
  res.json({ ok: true, approvedActionId: approval.id, action: redactSecrets(approval) });
}));
app.post("/v1/files/inspect", asyncRoute(async (req, res) => {
  const { attachment } = body<{ attachment?: Parameters<typeof inspectAttachment>[0] }>(req);
  if (!attachment) return void res.status(400).json({ error: "attachment is required" });
  res.json(inspectAttachment(attachment));
}));
app.post("/v1/github/repositories", asyncRoute(async (req, res) => {
  const token = typeof req.body?.githubToken === "string" ? req.body.githubToken.trim() : "";
  if (!token) return void res.status(400).json({ error: "GitHub token is required. Save GITHUB_TOKEN in the app settings first." });
  res.json(await githubListRepositories(token));
}));
app.post("/v1/github/tree", asyncRoute(async (req, res) => {
  const { owner, repo, branch, githubToken } = body<{ owner?: string; repo?: string; branch?: string; githubToken?: string }>(req);
  if (!githubToken?.trim()) return void res.status(400).json({ error: "GitHub token is required. Save GITHUB_TOKEN in the app settings first." });
  res.json(await githubListTree(owner ?? "", repo ?? "", branch, githubToken.trim()));
}));
app.post("/v1/github/file", asyncRoute(async (req, res) => {
  const { owner, repo, path, branch, githubToken } = body<{ owner?: string; repo?: string; path?: string; branch?: string; githubToken?: string }>(req);
  if (!githubToken?.trim()) return void res.status(400).json({ error: "GitHub token is required. Save GITHUB_TOKEN in the app settings first." });
  res.json(await githubReadFile(owner ?? "", repo ?? "", path ?? "", branch, githubToken.trim()));
}));
app.post("/v1/github/commit-file", asyncRoute(async (req, res) => {
  const { owner, repo, path, content, message, branch, githubToken } = body<{ owner?: string; repo?: string; path?: string; content?: string; message?: string; branch?: string; githubToken?: string }>(req);
  if (!githubToken?.trim()) return void res.status(400).json({ error: "GitHub token is required. Save GITHUB_TOKEN in the app settings first." });
  if (typeof content !== "string") return void res.status(400).json({ error: "File content is required." });
  res.json(await githubCommitFile(owner ?? "", repo ?? "", path ?? "", content, message ?? "Update file from HkTube Agent", branch, githubToken.trim()));
}));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = redactSecrets(error instanceof Error ? error.message : "Request failed");
  res.status(400).json({ error: message });
});

export default app;

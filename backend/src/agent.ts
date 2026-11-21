import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { githubTool, mcpTool, webFetch, webSearch, webhookTool } from "./connectors.js";
import { chat } from "./providers.js";
import { makeApprovalToken } from "./security.js";
import type { AgentEvent, AgentRequest, ApprovalRequest, PlanStep, ToolName } from "./types.js";

const approvals = new Map<string, { request: ApprovalRequest; token: string; expiresAt: number; consumed: boolean }>();
const writeOperations = new Set(["commit_file", "create_branch", "create_pull_request"]);

const inputString = (value: unknown) => typeof value === "string" ? value : "";
const inferSteps = (goal: string): PlanStep[] => {
  const lower = goal.toLowerCase();
  const steps: PlanStep[] = [{ id: randomUUID(), title: "Understand the request", description: "Validate the goal and identify the required information.", risky: false }];
  if (/search|research|latest|compare/.test(lower)) steps.push({ id: randomUUID(), title: "Research the request", description: "Search trusted web results and fetch relevant source material.", tool: "web_search", input: { query: goal }, risky: false });
  if (/fetch|read url|open https?:/.test(lower)) steps.push({ id: randomUUID(), title: "Read the requested page", description: "Fetch the requested public page with SSRF protections.", tool: "web_fetch", input: { url: goal.match(/https?:\/\/[^\s]+/)?.[0] ?? "" }, risky: false });
  if (/github|repository|repo|pull request|commit|branch|file/.test(lower)) steps.push({ id: randomUUID(), title: "Inspect GitHub context", description: "Use the GitHub connector to inspect the requested repository or file.", tool: "github", input: { operation: "list_repositories" }, risky: false });
  if (/webhook|send request|call api/.test(lower)) steps.push({ id: randomUUID(), title: "Call the external connector", description: "Send the requested outbound request only after explicit approval.", tool: "webhook", input: {}, risky: true });
  steps.push({ id: randomUUID(), title: "Prepare the answer", description: "Summarize verified results and remaining actions.", risky: false });
  return steps.slice(0, config.maxAgentSteps);
};

export const createPlan = (goal: string) => inferSteps(goal);
const stepRequiresApproval = (step: PlanStep) => step.risky || (step.tool === "github" && writeOperations.has(inputString(step.input?.operation)));

const executeTool = async (step: PlanStep, request: AgentRequest) => {
  if (!step.tool) return { note: step.description };
  if (step.tool === "web_search") return webSearch(step.input ?? { query: request.goal });
  if (step.tool === "web_fetch") return webFetch(step.input ?? {});
  if (step.tool === "github") {
    if (!request.githubToken) throw new Error("GitHub token is required for GitHub connector actions");
    return githubTool(step.input ?? {}, request.githubToken);
  }
  if (step.tool === "webhook") return webhookTool(step.input ?? {}, request.webhookAllowlist ?? []);
  if (step.tool === "mcp") return mcpTool(step.input ?? {}, request.webhookAllowlist ?? []);
  throw new Error(`Unsupported tool ${step.tool}`);
};

const approvalFor = (step: PlanStep) => {
  const id = step.id;
  const request: ApprovalRequest = { id, action: step.title, tool: step.tool ?? "webhook", input: step.input ?? {}, reason: step.description, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
  const token = makeApprovalToken();
  approvals.set(id, { request, token, expiresAt: Date.now() + 10 * 60_000, consumed: false });
  return { request, token };
};

export async function* runAgent(request: AgentRequest): AsyncGenerator<AgentEvent> {
  const steps = createPlan(request.goal);
  yield { type: "plan", data: steps };
  const approved = new Set(request.approvedActionIds ?? []);
  const observations: unknown[] = [];
  for (const step of steps) {
    yield { type: "step_started", stepId: step.id, data: { title: step.title, description: step.description } };
    if (stepRequiresApproval(step) && !approved.has(step.id)) {
      const approval = approvalFor(step);
      yield { type: "approval_required", stepId: step.id, data: { ...approval.request, approvalToken: approval.token } };
      return;
    }
    try {
      const result = await executeTool(step, request);
      observations.push({ step: step.title, result });
      yield { type: "step_completed", stepId: step.id, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed";
      yield { type: "error", stepId: step.id, data: message };
      return;
    }
  }
  try {
    const summary = await chat({ credentials: request.credentials, provider: request.provider, taskType: "agent", systemPrompt: "You are a careful agent summarizer. Summarize only the supplied observations; clearly label unknowns and never claim an action succeeded without evidence.", messages: [{ role: "user", content: `Goal: ${request.goal}\nObservations:\n${JSON.stringify(observations).slice(0, 50_000)}` }] });
    yield { type: "message", data: summary.text };
  } catch (error) {
    yield { type: "message", data: `Completed available steps. Summary provider unavailable: ${error instanceof Error ? error.message : "unknown error"}` };
  }
  yield { type: "done", data: { completedSteps: observations.length } };
}

export const consumeApproval = (approvalId: string, token: string) => {
  const value = approvals.get(approvalId);
  if (!value || value.consumed || Date.now() > value.expiresAt || value.token !== token) throw new Error("Approval is missing, expired, invalid, or already used");
  value.consumed = true;
  return value.request;
};

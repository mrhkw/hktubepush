import AsyncStorage from "@react-native-async-storage/async-storage";

export type WorkflowStepType = "prompt" | "condition" | "note" | "approval";
export type WorkflowStep = { id: string; type: WorkflowStepType; title: string; instruction: string; enabled: boolean };
export type Workflow = { id: string; name: string; createdAt: string; updatedAt: string; steps: WorkflowStep[]; lastRunAt?: string; lastStatus?: "completed" | "needs_approval" | "failed" };
const STORAGE_KEY = "pa_ios_workflows_v1";

export async function listWorkflows(): Promise<Workflow[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is Workflow => !!item && typeof item === "object" && typeof (item as Workflow).id === "string") : [];
  } catch {
    return [];
  }
}
export async function saveWorkflow(workflow: Workflow): Promise<void> {
  const current = await listWorkflows();
  const next = [workflow, ...current.filter((item) => item.id !== workflow.id)];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
export async function deleteWorkflow(id: string): Promise<void> {
  const current = await listWorkflows();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current.filter((item) => item.id !== id)));
}
export async function runWorkflow(workflow: Workflow): Promise<Workflow> {
  if (!workflow.steps.length) throw new Error("Add at least one workflow step.");
  const requiresApproval = workflow.steps.some((step) => step.enabled && step.type === "approval");
  const updated: Workflow = { ...workflow, updatedAt: new Date().toISOString(), lastRunAt: new Date().toISOString(), lastStatus: requiresApproval ? "needs_approval" : "completed" };
  await saveWorkflow(updated);
  return updated;
}

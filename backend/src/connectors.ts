import { assertNonEmptyString } from "./config.js";
import { assertSafeHttpUrl } from "./security.js";

const github = async (path: string, init: RequestInit, token: string) => {
  const response = await fetch(`https://api.github.com${path}`, { ...init, headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return response.json();
};

const decodeBase64 = (value: string) => Buffer.from(value, "base64").toString("utf8");
const encodeBase64 = (value: string) => Buffer.from(value, "utf8").toString("base64");

const githubOwnerRepo = (owner: unknown, repo: unknown) => ({ owner: encodeURIComponent(assertNonEmptyString(owner, "github.owner", 100)), repo: encodeURIComponent(assertNonEmptyString(repo, "github.repo", 100)) });

export const githubListRepositories = (token: string) => github("/user/repos?per_page=100&sort=updated", { method: "GET" }, token);
export const githubListTree = async (owner: string, repo: string, branch = "main", token: string) => {
  const names = githubOwnerRepo(owner, repo);
  const ref = await github(`/repos/${names.owner}/${names.repo}/git/ref/heads/${encodeURIComponent(assertNonEmptyString(branch, "github.branch", 120))}`, { method: "GET" }, token);
  return github(`/repos/${names.owner}/${names.repo}/git/trees/${encodeURIComponent(ref.object.sha)}?recursive=1`, { method: "GET" }, token);
};
export const githubReadFile = async (owner: string, repo: string, path: string, branch = "main", token: string) => {
  const names = githubOwnerRepo(owner, repo);
  const safePath = encodeURIComponent(assertNonEmptyString(path, "github.path", 500)).replace(/%2F/g, "/");
  const result = await github(`/repos/${names.owner}/${names.repo}/contents/${safePath}?ref=${encodeURIComponent(branch)}`, { method: "GET" }, token);
  return { path: result.path, sha: result.sha, content: result.encoding === "base64" ? decodeBase64(result.content) : result.content };
};
export const githubCommitFile = async (owner: string, repo: string, path: string, content: string, message: string, branch = "main", token: string) => {
  const names = githubOwnerRepo(owner, repo);
  const safePath = assertNonEmptyString(path, "github.path", 500);
  const safeBranch = assertNonEmptyString(branch, "github.branch", 120);
  const previous = await githubReadFile(owner, repo, safePath, safeBranch, token).catch(() => undefined);
  return github(`/repos/${names.owner}/${names.repo}/contents/${safePath}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: assertNonEmptyString(message, "github.message", 500), content: encodeBase64(assertNonEmptyString(content, "github.content", 2_000_000)), branch: safeBranch, ...(previous?.sha ? { sha: previous.sha } : {}) }) }, token);
};

export const githubTool = async (input: Record<string, unknown>, token: string) => {
  const operation = assertNonEmptyString(input.operation, "github.operation", 40);
  if (operation === "list_repositories") return githubListRepositories(token);
  const owner = assertNonEmptyString(input.owner, "github.owner", 100);
  const repo = assertNonEmptyString(input.repo, "github.repo", 100);
  if (operation === "read_file") {
    const path = encodeURIComponent(assertNonEmptyString(input.path, "github.path", 500)).replace(/%2F/g, "/");
    const result = await github(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`, { method: "GET" }, token);
    return { path: result.path, sha: result.sha, content: result.encoding === "base64" ? decodeBase64(result.content) : result.content };
  }
  if (operation === "create_branch") {
    const branch = assertNonEmptyString(input.branch, "github.branch", 120);
    const from = assertNonEmptyString(input.from ?? "main", "github.from", 120);
    const ref = await github(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(from)}`, { method: "GET" }, token);
    return github(`/repos/${owner}/${repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }), headers: { "content-type": "application/json" } }, token);
  }
  if (operation === "commit_file") {
    const path = assertNonEmptyString(input.path, "github.path", 500);
    const message = assertNonEmptyString(input.message, "github.message", 500);
    const branch = assertNonEmptyString(input.branch ?? "main", "github.branch", 120);
    const content = assertNonEmptyString(input.content, "github.content", 2_000_000);
    let sha: string | undefined;
    try { sha = (await github(`/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, { method: "GET" }, token)).sha; } catch { /* new file */ }
    return github(`/repos/${owner}/${repo}/contents/${path}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, content: encodeBase64(content), branch, ...(sha ? { sha } : {}) }) }, token);
  }
  if (operation === "create_pull_request") {
    const title = assertNonEmptyString(input.title, "github.title", 300);
    const head = assertNonEmptyString(input.head, "github.head", 120);
    const base = assertNonEmptyString(input.base ?? "main", "github.base", 120);
    return github(`/repos/${owner}/${repo}/pulls`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, body: typeof input.body === "string" ? input.body : "", head, base }) }, token);
  }
  throw new Error(`Unsupported GitHub operation: ${operation}`);
};

const responseBody = async (response: Response) => (await response.text()).slice(0, 200_000);
export const webFetch = async (input: Record<string, unknown>) => {
  const url = assertSafeHttpUrl(assertNonEmptyString(input.url, "url", 2_000));
  const response = await fetch(url, { headers: { accept: "text/html,text/plain,application/json" }, signal: AbortSignal.timeout(15_000) });
  return { url: url.toString(), status: response.status, contentType: response.headers.get("content-type"), body: await responseBody(response) };
};

export const webSearch = async (input: Record<string, unknown>) => {
  const query = encodeURIComponent(assertNonEmptyString(input.query, "query", 500));
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${query}`, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
  const html = await response.text();
  const results = [...html.matchAll(/result__a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].slice(0, 8).flatMap(match => match[1] && match[2] ? [{ url: match[1], title: match[2].replace(/<[^>]+>/g, "") }] : []);
  return { query: decodeURIComponent(query), results };
};

export const webhookTool = async (input: Record<string, unknown>, allowlist: string[] = []) => {
  const url = assertSafeHttpUrl(assertNonEmptyString(input.url, "url", 2_000), allowlist);
  const method = String(input.method ?? "POST").toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error("Webhook method is not allowed");
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(input.body ?? {}), signal: AbortSignal.timeout(15_000) });
  return { url: url.toString(), status: response.status, body: await responseBody(response) };
};

export const mcpTool = async (input: Record<string, unknown>, allowlist: string[] = []) => {
  const url = assertSafeHttpUrl(assertNonEmptyString(input.url, "url", 2_000), allowlist);
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: assertNonEmptyString(input.method ?? "tools/list", "mcp.method", 200), params: input.params ?? {} }), signal: AbortSignal.timeout(15_000) });
  return { url: url.toString(), status: response.status, body: await responseBody(response) };
};

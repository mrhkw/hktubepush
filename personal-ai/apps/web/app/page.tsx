"use client";

import { FormEvent, useEffect, useState } from "react";
import { Activity, Bot, BrainCircuit, Code2, Command, Cpu, LayoutDashboard, Plug, Search, Send, Settings2, ShieldCheck, Sparkles, Workflow } from "lucide-react";

type Provider = "openai" | "gemini" | "anthropic" | "deepseek" | "ollama";
type Message = { role: "user" | "assistant"; content: string };
type ProviderStatus = Record<Provider, boolean>;

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
const providers: { id: Provider; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Gemini" },
  { id: "anthropic", label: "Claude" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "ollama", label: "Ollama (local)" },
];

export default function HomePage() {
  const [provider, setProvider] = useState<Provider>("ollama");
  const [status, setStatus] = useState<ProviderStatus>({ openai: false, gemini: false, anthropic: false, deepseek: false, ollama: false });
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Personal AI OS is ready. Configure a model provider on the API server, then send your first task." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/v1/providers`)
      .then(async (response) => {
        if (!response.ok) throw new Error("API is not reachable");
        return response.json() as Promise<{ configured: ProviderStatus }>;
      })
      .then((data) => { if (active) setStatus(data.configured); })
      .catch(() => { if (active) setError("Backend unavailable. Start the FastAPI service on port 8000."); });
    return () => { active = false; };
  }, []);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || loading) return;
    setError("");
    setMessages((current) => [...current, { role: "user", content: message }]);
    setInput("");
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, message }),
      });
      const data = await response.json() as { response?: string; detail?: string };
      if (!response.ok) throw new Error(data.detail || "AI request failed");
      setMessages((current) => [...current, { role: "assistant", content: data.response || "The provider returned an empty response." }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected request error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><BrainCircuit size={22} /></div><div><strong>Personal AI</strong><span>YOUR PRIVATE OS</span></div></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="nav-list">
          <a className="nav-item active" href="#"><LayoutDashboard size={17} /> Overview</a>
          <a className="nav-item" href="#chat"><Bot size={17} /> AI Chat</a>
          <span className="nav-item disabled"><Workflow size={17} /> Agents <small>Planned</small></span>
          <span className="nav-item disabled"><Code2 size={17} /> Coding Studio <small>Planned</small></span>
          <span className="nav-item disabled"><Plug size={17} /> Integrations <small>Planned</small></span>
          <span className="nav-item disabled"><Activity size={17} /> Workflows <small>Planned</small></span>
          <span className="nav-item disabled"><Settings2 size={17} /> Settings <small>Planned</small></span>
        </nav>
        <div className="sidebar-bottom"><ShieldCheck size={16} /><span>Private-first architecture</span></div>
      </aside>

      <section className="main-panel">
        <header className="topbar"><div className="crumb"><Command size={15} /> <span>Personal workspace</span> <b>/</b> Overview</div><div className="top-status"><span className="status-dot" /> Local-first mode</div></header>
        <div className="content">
          <section className="hero">
            <div><div className="eyebrow"><Sparkles size={14} /> PERSONAL AI COMMAND CENTER</div><h1>Your intelligence.<br /><span>Your infrastructure.</span></h1><p>A private workspace for models, agents, projects and automation. Built in phases, with real integrations rather than decorative switches.</p></div>
            <div className="hero-orb"><BrainCircuit size={66} strokeWidth={1.1} /><div className="orb-ring" /></div>
          </section>

          <section className="stats-grid">
            <div className="stat-card"><div className="stat-icon"><Cpu size={18} /></div><span>Model providers</span><strong>{Object.values(status).filter(Boolean).length} <small>/ 5 configured</small></strong></div>
            <div className="stat-card"><div className="stat-icon"><Bot size={18} /></div><span>Agent runtime</span><strong>In development</strong></div>
            <div className="stat-card"><div className="stat-icon"><ShieldCheck size={18} /></div><span>Security posture</span><strong>Foundation</strong></div>
          </section>

          <section className="chat-card" id="chat">
            <div className="section-heading"><div><div className="eyebrow">MODEL PLAYGROUND</div><h2>Talk to your AI</h2></div><div className="live-label"><span className="status-dot" /> API workspace</div></div>
            <div className="chat-toolbar"><label htmlFor="provider">MODEL PROVIDER</label><select id="provider" value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>{providers.map((item) => <option key={item.id} value={item.id}>{item.label}{status[item.id] ? " · configured" : " · not configured"}</option>)}</select><span className={status[provider] ? "provider-state ready" : "provider-state"}>{status[provider] ? "Configured" : "Needs setup"}</span></div>
            <div className="messages" aria-live="polite">{messages.map((message, index) => <div className={`message ${message.role}`} key={index}><div className="message-avatar">{message.role === "assistant" ? <BrainCircuit size={16} /> : "YOU"}</div><div className="message-content"><span>{message.role === "assistant" ? "PERSONAL AI" : "YOU"}</span><p>{message.content}</p></div></div>)}{loading && <div className="message assistant"><div className="message-avatar"><BrainCircuit size={16} /></div><div className="message-content"><span>PERSONAL AI</span><p className="typing">Thinking…</p></div></div>}</div>
            {error && <div className="error-banner" role="alert">{error}</div>}
            <form className="composer" onSubmit={sendMessage}><input value={input} onChange={(event) => setInput(event.target.value)} maxLength={20000} placeholder="Give your AI a task…" aria-label="Message your AI" /><button type="submit" disabled={loading || !input.trim()} aria-label="Send message"><Send size={17} /></button></form>
            <p className="privacy-note"><ShieldCheck size={13} /> Provider credentials stay on the backend. External providers receive prompts you send to them.</p>
          </section>

          <section className="bottom-grid">
            <div className="info-card"><div className="card-icon"><Search size={18} /></div><h3>Build with evidence</h3><p>Every module gets an implementation status and acceptance test. No fake connected badges.</p></div>
            <div className="info-card"><div className="card-icon"><Workflow size={18} /></div><h3>Agent ecosystem</h3><p>Orchestration, specialized agents, tool permissions and workflow execution are the next milestones.</p></div>
          </section>
          <footer>PERSONAL AI OS <span>·</span> PRIVATE-FIRST <span>·</span> DEVELOPMENT BUILD</footer>
        </div>
      </section>
    </main>
  );
}

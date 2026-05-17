"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { KeyRound, CheckCircle, XCircle, Trash2, ExternalLink, Sparkles, ShieldCheck, Database } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface UserSettings {
  email: string;
  createdAt: string;
  hasGroqKey: boolean;
  maskedGroqKey: string | null;
  hasGeminiKey: boolean;
  maskedGeminiKey: string | null;
}

export default function SettingsPage() {
  const { token } = useAuth();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  
  const [groqKey, setGroqKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  
  const [loading, setLoading] = useState(true);
  const [savingGroq, setSavingGroq] = useState(false);
  const [savingGemini, setSavingGemini] = useState(false);
  
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/users/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setSettings(data))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSave = async (type: 'groq' | 'gemini') => {
    if (!token) return;
    
    const isGroq = type === 'groq';
    const keyToSave = isGroq ? groqKey.trim() : geminiKey.trim();
    if (!keyToSave) return;
    
    if (isGroq) setSavingGroq(true); else setSavingGemini(true);
    setStatus("idle");
    try {
      const res = await fetch(`${API_BASE}/users/settings`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          ...(isGroq ? { groqApiKey: keyToSave } : { geminiApiKey: keyToSave }) 
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setStatus("success");
      setStatusMsg(`${isGroq ? 'Groq' : 'Gemini'} API key saved successfully.`);
      if (isGroq) setGroqKey(""); else setGeminiKey("");
      
      const updated = await fetch(`${API_BASE}/users/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json());
      setSettings(updated);
    } catch {
      setStatus("error");
      setStatusMsg("Failed to save key. Please try again.");
    } finally {
      if (isGroq) setSavingGroq(false); else setSavingGemini(false);
    }
  };

  const handleRevoke = async (type: 'groq' | 'gemini') => {
    if (!token) return;
    const isGroq = type === 'groq';
    
    if (isGroq) setSavingGroq(true); else setSavingGemini(true);
    try {
      await fetch(`${API_BASE}/users/settings`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(isGroq ? { groqApiKey: null } : { geminiApiKey: null })
        }),
      });
      setStatus("success");
      setStatusMsg(`${isGroq ? 'Groq' : 'Gemini'} API key removed.`);
      const updated = await fetch(`${API_BASE}/users/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json());
      setSettings(updated);
    } finally {
      if (isGroq) setSavingGroq(false); else setSavingGemini(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-neo-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Settings</h1>
        <p className="text-neo-muted font-medium mt-1">
          Configure your account and AI features.
        </p>
      </div>

      {status !== "idle" && (
        <div
          className={`flex items-center gap-2 p-3 border-4 border-black font-bold text-sm ${
            status === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
          }`}
        >
          {status === "success" ? (
            <CheckCircle className="w-4 h-4 shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 shrink-0" />
          )}
          {statusMsg}
        </div>
      )}

      {/* Account info */}
      <div className="neo-card p-6 space-y-3">
        <h2 className="font-black text-lg uppercase tracking-tight flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-neo-primary" />
          Account
        </h2>
        <div className="flex justify-between items-center py-3 border-b-2 border-black">
          <span className="font-bold text-neo-muted">Email</span>
          <span className="font-bold">{settings?.email}</span>
        </div>
        <div className="flex justify-between items-center py-3">
          <span className="font-bold text-neo-muted">Member since</span>
          <span className="font-bold">
            {settings?.createdAt
              ? new Date(settings.createdAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })
              : "—"}
          </span>
        </div>
      </div>

      {/* Groq Key */}
      <div className="neo-card p-6 space-y-5">
        <div>
          <h2 className="font-black text-lg uppercase tracking-tight flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-neo-primary" />
            Groq API Key (Llama-3)
          </h2>
          <p className="text-sm text-neo-muted font-medium mt-2 leading-relaxed">
            Add your personal{" "}
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-neo-primary underline font-bold inline-flex items-center gap-1"
            >
              Groq API key <ExternalLink className="w-3 h-3" />
            </a>{" "}
            to power the real-time content classification, nudges, and AI Coach Chat generation.
          </p>
        </div>

        <div
          className={`flex items-center gap-3 p-4 border-4 border-black font-bold ${
            settings?.hasGroqKey ? "bg-green-100" : "bg-neo-surface"
          }`}
        >
          {settings?.hasGroqKey ? (
            <>
              <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
              <div>
                <span className="block">Groq active</span>
                <span className="text-sm font-mono text-neo-muted">{settings.maskedGroqKey}</span>
              </div>
            </>
          ) : (
            <>
              <XCircle className="w-5 h-5 text-neo-muted shrink-0" />
              <span>No key provided — using server fallback</span>
            </>
          )}
        </div>

        <div className="space-y-3">
          <label className="block font-bold text-sm uppercase tracking-wide">
            {settings?.hasGroqKey ? "Replace Key" : "Add Key"}
          </label>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neo-muted" />
              <input
                type="password"
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave('groq')}
                placeholder="gsk_••••••••••••••••••••••••"
                className="w-full pl-10 pr-4 py-3 border-4 border-black font-mono text-sm focus:outline-none focus:border-neo-primary bg-white"
              />
            </div>
            <button
              onClick={() => handleSave('groq')}
              disabled={savingGroq || !groqKey.trim()}
              className="px-6 py-3 bg-neo-primary text-white font-black uppercase border-4 border-black shadow-neo hover:translate-x-1 hover:-translate-y-1 transition-transform disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-x-0 disabled:translate-y-0"
            >
              {savingGroq ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {settings?.hasGroqKey && (
          <button
            onClick={() => handleRevoke('groq')}
            disabled={savingGroq}
            className="flex items-center gap-2 text-sm font-bold text-red-600 hover:text-red-800 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Remove Groq key
          </button>
        )}
      </div>

      {/* Gemini Key */}
      <div className="neo-card p-6 space-y-5">
        <div>
          <h2 className="font-black text-lg uppercase tracking-tight flex items-center gap-2">
            <Database className="w-5 h-5 text-neo-primary" />
            Gemini API Key (Embeddings)
          </h2>
          <p className="text-sm text-neo-muted font-medium mt-2 leading-relaxed">
            Add your personal{" "}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-neo-primary underline font-bold inline-flex items-center gap-1"
            >
              Gemini API key <ExternalLink className="w-3 h-3" />
            </a>{" "}
            to power the vector database semantic search. This embeds your telemetry for long-term memory retrieval.
          </p>
        </div>

        <div
          className={`flex items-center gap-3 p-4 border-4 border-black font-bold ${
            settings?.hasGeminiKey ? "bg-green-100" : "bg-neo-surface"
          }`}
        >
          {settings?.hasGeminiKey ? (
            <>
              <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
              <div>
                <span className="block">Gemini active</span>
                <span className="text-sm font-mono text-neo-muted">{settings.maskedGeminiKey}</span>
              </div>
            </>
          ) : (
            <>
              <XCircle className="w-5 h-5 text-neo-muted shrink-0" />
              <span>No key provided — using server fallback</span>
            </>
          )}
        </div>

        <div className="space-y-3">
          <label className="block font-bold text-sm uppercase tracking-wide">
            {settings?.hasGeminiKey ? "Replace Key" : "Add Key"}
          </label>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neo-muted" />
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave('gemini')}
                placeholder="AIzaSy••••••••••••••••••••••••"
                className="w-full pl-10 pr-4 py-3 border-4 border-black font-mono text-sm focus:outline-none focus:border-neo-primary bg-white"
              />
            </div>
            <button
              onClick={() => handleSave('gemini')}
              disabled={savingGemini || !geminiKey.trim()}
              className="px-6 py-3 bg-neo-primary text-white font-black uppercase border-4 border-black shadow-neo hover:translate-x-1 hover:-translate-y-1 transition-transform disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-x-0 disabled:translate-y-0"
            >
              {savingGemini ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {settings?.hasGeminiKey && (
          <button
            onClick={() => handleRevoke('gemini')}
            disabled={savingGemini}
            className="flex items-center gap-2 text-sm font-bold text-red-600 hover:text-red-800 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Remove Gemini key
          </button>
        )}
      </div>

    </div>
  );
}

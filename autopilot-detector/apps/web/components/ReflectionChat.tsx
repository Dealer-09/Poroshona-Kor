"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
}

const PREDEFINED_PROMPTS = [
  "Why do I doomscroll on Twitter?",
  "What triggers my cognitive drift?",
  "How was my focus today?",
  "Summarize my recent habits",
];

export function ReflectionChat() {
  const { token } = useAuth();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "ai",
      content: "I am your Autopilot Coach. Let's reflect on your recent telemetry data. What's on your mind?",
    }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleSend = async (text: string) => {
    if (!text.trim()) return;

    // Add user message
    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const res = await fetch(`${API_BASE}/ai/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) {
        throw new Error("Failed to get response");
      }

      const data = await res.json();
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "ai",
        content: data.response,
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (err) {
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "ai",
        content: "I had trouble connecting to my AI brain. Please try again later.",
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full absolute inset-0">
      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] p-4 font-bold text-lg border-4 border-black shadow-[4px_4px_0_rgba(0,0,0,1)] ${
              msg.role === "user" 
                ? "bg-neo-primary text-white" 
                : "bg-neo-secondary text-black"
            }`}>
              {msg.role === "ai" && <Sparkles className="inline-block w-5 h-5 mr-2 mb-1" />}
              {msg.content}
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start">
            <div className="p-4 font-bold text-lg border-4 border-black shadow-[4px_4px_0_rgba(0,0,0,1)] bg-neo-surface animate-pulse">
              <span className="opacity-50">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Prompts & Input */}
      <div className="p-4 bg-neo-bg border-t-4 border-black space-y-4">
        {messages.length <= 2 && (
          <div className="flex flex-wrap gap-2">
            {PREDEFINED_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                onClick={() => handleSend(prompt)}
                className="px-3 py-1 bg-white border-2 border-black font-bold text-sm shadow-neo hover:bg-neo-primary hover:text-white transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
        
        <form 
          onSubmit={(e) => { e.preventDefault(); handleSend(input); }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 p-4 border-4 border-black font-bold text-lg focus:outline-none focus:bg-yellow-50 transition-colors"
          />
          <button 
            type="submit"
            disabled={isTyping || !input.trim()}
            className="neo-btn px-6 flex items-center justify-center disabled:opacity-50"
          >
            <Send className="w-6 h-6" />
          </button>
        </form>
      </div>
    </div>
  );
}

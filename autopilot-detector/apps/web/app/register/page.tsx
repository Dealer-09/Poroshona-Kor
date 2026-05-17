"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      const res = await fetch("http://localhost:3000/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to register");
      }

      login(data.access_token);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-neo-accent">
      <div className="w-full max-w-md neo-card p-8">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-black uppercase tracking-tighter mb-2 text-white bg-black inline-block px-4 py-1">Register</h1>
          <p className="font-bold mt-4">JOIN THE AUTOPILOT DETECTOR</p>
        </div>

        {error && (
          <div className="bg-neo-primary text-white p-3 font-bold border-4 border-black shadow-neo-sm mb-6">
            Error: {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block font-black uppercase text-sm">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="neo-input"
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="block font-black uppercase text-sm">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="neo-input"
              placeholder="••••••••"
              required
            />
          </div>

          <button type="submit" className="neo-btn-secondary w-full text-xl mt-4">
            CREATE ACCOUNT →
          </button>
        </form>

        <div className="mt-8 text-center font-bold">
          <p>ALREADY HAVE AN ACCOUNT? <Link href="/login" className="text-neo-primary hover:underline decoration-4 underline-offset-4">LOGIN HERE</Link></p>
        </div>
      </div>
    </div>
  );
}

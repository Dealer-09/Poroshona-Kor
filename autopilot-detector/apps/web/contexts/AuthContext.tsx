"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface AuthContextType {
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    // Check local storage on mount
    const storedToken = localStorage.getItem("access_token");
    if (storedToken) {
      setToken(storedToken);
      // Broadcast to Chrome Extension Content Script
      window.postMessage({ type: "AUTOPILOT_AUTH_TOKEN", token: storedToken }, "*");
    }
  }, []);

  const login = (newToken: string) => {
    setToken(newToken);
    localStorage.setItem("access_token", newToken);
    // Also set as cookie for Next.js middleware to read
    document.cookie = `access_token=${newToken}; path=/; max-age=${60 * 60 * 24 * 7}`;
    
    // Broadcast to Chrome Extension Content Script immediately
    window.postMessage({ type: "AUTOPILOT_AUTH_TOKEN", token: newToken }, "*");
    
    router.push("/dashboard");
  };

  const logout = () => {
    setToken(null);
    localStorage.removeItem("access_token");
    document.cookie = "access_token=; path=/; max-age=0";
    router.push("/login");
  };

  return (
    <AuthContext.Provider value={{ token, isAuthenticated: !!token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

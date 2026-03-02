"use client";
import { useState } from "react";

export function LoginScreen({ onLogin }: { onLogin: (token: string) => void }) {
  const [token, setToken] = useState("");
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg-darkest)" }}>
      <div className="glass-card max-w-sm w-full text-center space-y-5">
        <span className="text-5xl block">🌱</span>
        <h1 className="text-2xl font-bold">Groot Dashboard</h1>
        <p className="text-gray-400 text-sm">Enter your access token</p>
        <input
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          onKeyDown={e => e.key === "Enter" && token && onLogin(token)}
          placeholder="Token"
          className="w-full px-4 py-3 bg-white/5 border border-white/[0.08] rounded-lg text-sm focus:outline-none focus:border-emerald-500/40"
        />
        <button
          onClick={() => token && onLogin(token)}
          className="w-full px-4 py-3 bg-emerald-500/20 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-500/30 transition-colors"
        >
          Login
        </button>
      </div>
    </div>
  );
}

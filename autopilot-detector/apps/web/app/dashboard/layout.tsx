"use client";

import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, LayoutDashboard, MessageSquare, LogOut } from "lucide-react";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  const pathname = usePathname();

  const navItems = [
    { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
    { name: "Sessions", href: "/dashboard/sessions", icon: Activity },
    { name: "AI Coach", href: "/dashboard/coach", icon: MessageSquare },
  ];

  return (
    <div className="flex h-screen bg-neo-bg">
      {/* Sidebar */}
      <aside className="w-64 neo-card h-full flex flex-col justify-between p-6">
        <div>
          <div className="mb-10">
            <h1 className="text-2xl font-black uppercase tracking-tighter bg-neo-primary text-white inline-block px-2 py-1 transform -rotate-2">AUTOPILOT</h1>
            <p className="font-bold text-sm mt-1">DETECTOR_SYS</p>
          </div>

          <nav className="space-y-4">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center space-x-3 font-bold text-lg p-3 border-4 border-black transition-all ${
                    isActive 
                      ? "bg-neo-secondary shadow-neo translate-x-1" 
                      : "bg-white hover:bg-neo-surface hover:-translate-y-1 hover:shadow-neo"
                  }`}
                >
                  <item.icon className="w-6 h-6" />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="space-y-4">
          <button 
            onClick={logout}
            className="flex items-center space-x-3 w-full font-bold text-lg p-3 bg-neo-dark text-white border-4 border-black hover:bg-neo-primary transition-colors"
          >
            <LogOut className="w-6 h-6" />
            <span>LOGOUT</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-10">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

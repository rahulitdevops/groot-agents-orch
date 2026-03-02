import React from "react";

interface CardProps {
  title?: string;
  icon?: string;
  children: React.ReactNode;
  className?: string;
  variant?: "glass" | "solid" | "elevated";
  noPadding?: boolean;
}

export function Card({ title, icon, children, className = "", variant = "glass", noPadding }: CardProps) {
  const base = variant === "solid" ? "glass-card-solid" : variant === "elevated" ? "glass-elevated" : "glass-card";
  return (
    <div className={`${base} ${noPadding ? "!p-0" : ""} animate-fade-in ${className}`}>
      {title && (
        <h2 className={`text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2 ${noPadding ? "px-4 pt-4" : ""}`}>
          {icon && <span>{icon}</span>}{title}
        </h2>
      )}
      {children}
    </div>
  );
}

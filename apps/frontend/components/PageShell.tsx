'use client';

import React from 'react';
import Navbar from './NavBar';

interface PageShellProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}

export default function PageShell({ title, subtitle, children }: PageShellProps) {
  return (
    <div
      className="min-h-screen text-text relative overflow-hidden"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div
          className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full blur-[128px]"
          style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
        />
        <div
          className="absolute bottom-[-10%] right-[-10%] w-96 h-96 rounded-full blur-[128px]"
          style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}
        />
      </div>

      <div className="relative z-10">
        <Navbar />
        <div className="container mx-auto max-w-6xl p-4 lg:p-8 pt-28 lg:pt-32">
          <div className="mx-auto w-full max-w-4xl bg-surface-70 rounded-3xl p-8 border border-border shadow-soft">
            {title && (
              <div className="mb-8">
                <h1 className="text-3xl font-black text-text tracking-tight mb-2">{title}</h1>
                {subtitle && <p className="text-muted">{subtitle}</p>}
              </div>
            )}

            <div className="content">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


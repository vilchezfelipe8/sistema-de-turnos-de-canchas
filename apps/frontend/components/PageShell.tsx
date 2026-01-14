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
    <div className="min-h-screen text-text" style={{ backgroundColor: 'var(--bg)' }}>
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
  );
}


/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './modules/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Pique semantic tokens (all read from pique.css)
        'p-bg': 'var(--bg)',
        'p-surface': 'var(--surface-1)',
        'p-surface-2': 'var(--surface-2)',
        'p-surface-3': 'var(--surface-3)',
        'p-border': 'var(--border)',
        'p-border-strong': 'var(--border-strong)',
        'p-text': 'var(--text-primary)',
        'p-text-secondary': 'var(--text-secondary)',
        'p-text-muted': 'var(--text-muted)',
        'p-brand': 'var(--brand)',
        'p-brand-on': 'var(--brand-on)',
        'p-accent': 'var(--accent-fg)',
        'p-positive': 'var(--positive-fg)',
        'p-positive-bg': 'var(--positive-bg)',
        'p-error': 'var(--error-fg)',
        'p-error-bg': 'var(--error-bg)',
        'p-warning': 'var(--warn-fg)',
        'p-warning-bg': 'var(--warn-bg)',
        'p-info': 'var(--info-fg)',
        'p-info-bg': 'var(--info-bg)',

        // Amber scale (pending en agenda)
        'amber-100': '#FEF3C7',
        'amber-200': '#FDE68A',
        'amber-300': '#FCD34D',
        'amber-700': '#B45309',
        'amber-800': '#92400E',
        'amber-900': '#78350F',

        // Blue scale (completed en agenda)
        'blue-100': '#DBEAFE',
        'blue-200': '#BFDBFE',
        'blue-300': '#93C5FD',

        // Red scale (blocked en agenda)
        'red-100':  '#FEE2E2',
        'red-200':  '#FECACA',
        'red-300':  '#FCA5A5',
        'red-800':  '#991B1B',
        'red-900':  '#7F1D1D',

        // Pique raw lima scale
        'lima-50': '#F0FBDD',
        'lima-100': '#DFFDB0',
        'lima-200': '#CCFB8A',
        'lima-300': '#B6F36A',
        'lima-400': '#8BD04A',
        'lima-500': '#6AB030',
        'lima-600': '#4E8D25',
        'lima-700': '#3A6B1C',
        'lima-800': '#2B5014',
        'lima-900': '#1F3A0E',

        // Pique raw ink scale
        'ink-50': '#F5F4F0',
        'ink-100': '#DBD9D1',
        'ink-200': '#C5C3BC',
        'ink-300': '#9A9890',
        'ink-400': '#6F6A60',
        'ink-500': '#41464F',
        'ink-600': '#303849',
        'ink-700': '#252B38',
        'ink-800': '#1A1E27',
        'ink-900': '#0E1116',

        // Compatibility aliases resolved to Pique semantic tokens
        bg: 'var(--bg)',
        surface: 'var(--surface-1)',
        muted: 'var(--text-muted)',
        text: 'var(--text-primary)',
        border: 'var(--border)',
        accent: 'var(--accent-fg)',
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['Geist Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        soft: 'var(--shadow-md)',
        'p-card': 'var(--shadow-card)',
        'p-md': 'var(--shadow-md)',
        'p-lg': 'var(--shadow-lg)',
        'p-focus': 'var(--shadow-focus)',
      },
      borderRadius: {
        'p-sm': 'var(--r-sm)',
        'p-md': 'var(--r-md)',
        'p-lg': 'var(--r-lg)',
        'p-xl': 'var(--r-xl)',
        'p-2xl': 'var(--r-2xl)',
        'p-pill': 'var(--r-pill)',
      },
    },
  },
  plugins: [],
};

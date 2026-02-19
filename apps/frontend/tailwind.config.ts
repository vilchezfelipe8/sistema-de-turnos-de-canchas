/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}", // Si usas carpeta src
    "./pages/**/*.{js,ts,jsx,tsx,mdx}", // Si NO usas carpeta src
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        muted: 'var(--muted)',
        'muted-2': 'var(--muted-2)',
        text: 'var(--text)',
        border: 'var(--border)',
        accent: 'var(--accent)'
      },
      boxShadow: {
        soft: '0 4px 24px rgba(0,0,0,0.6)'
      }
    },
  },
  plugins: [],
}
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        term: {
          bg: '#0b0e14',
          panel: '#12161f',
          card: '#141926',
          border: '#232a3b',
          muted: '#7c8598',
          accent: '#3b82f6',
          green: '#16c784',
          red: '#ea3943',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}

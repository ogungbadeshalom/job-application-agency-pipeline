import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // JobOps-style dark navy palette
        navy: {
          950: '#0d1117', // page background
          900: '#161b22', // cards / panels
          850: '#1c2128',
          800: '#21262d', // table rows
          750: '#2a3038',
          700: '#30363d', // borders
          600: '#484f58',
          500: '#6e7681', // muted text
          400: '#8b949e',
          300: '#c9d1d9',
          200: '#d0d7de',
          100: '#e6edf3', // primary text
        },
        brand: {
          green: '#3fb950',
          greenDark: '#238636',
          blue: '#58a6ff',
          yellow: '#d29922',
          red: '#f85149',
          purple: '#bc8cff',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;

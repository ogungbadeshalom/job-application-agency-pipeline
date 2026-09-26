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
        // JobOps-style dark navy palette — reshaded to the Command Deck
        // aesthetic (near-black bg, deep panels, hairline borders). Every
        // screen keys off these tokens, so the whole app inherits the deck.
        navy: {
          950: '#0b0f17', // page background (deck bg)
          900: '#111826', // cards / panels (deck panel)
          850: '#16202f', // elevated panel-2
          800: '#1b2738', // table rows / hover
          750: '#22304a',
          700: '#1d2939', // hairline borders (deck border)
          600: '#2a3a50', // border-strong
          500: '#5f6f8a', // muted text (deck faint)
          400: '#8b9bb4', // deck muted
          300: '#b6c2d6',
          200: '#c9d1d9',
          100: '#e7ecf5', // primary text (deck text)
        },
        brand: {
          green: 'var(--accent)',
          greenDark: 'var(--accent-dark)',
          greenStrong: 'var(--accent-strong)',
          blue: '#58a6ff',
          yellow: '#d29922',
          red: '#f85149',
          purple: '#bc8cff',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'Menlo', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 2px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.24)',
        'panel-accent': '0 8px 28px -8px var(--accent-glow)',
      },
      transitionTimingFunction: {
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
      },
    },
  },
  plugins: [],
};

export default config;

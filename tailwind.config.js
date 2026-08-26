/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Control-room dark palette
        base: {
          950: '#0a0c10',
          900: '#0e1117',
          850: '#141821',
          800: '#1a1f2b',
          750: '#222836',
          700: '#2a3142',
          600: '#3a4256',
        },
        accent: {
          cyan: '#22d3ee',
          emerald: '#34d399',
          amber: '#fbbf24',
          red: '#f87171',
          slate: '#94a3b8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.9rem' }],
      },
    },
  },
  plugins: [],
};

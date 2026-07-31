import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Core brand — pulled directly from logo
        brand: {
          bg:         '#1A0A2E', // deep dark purple background
          card:       '#251340', // slightly lighter for surfaces
          border:     '#3B1F6A', // subtle borders
          purple:     '#5B21B6', // the logo stroke / accent
          'purple-light': '#7C3AED',
          orange:     '#F5921E', // primary orange
          amber:      '#FFB74D', // lighter gold for gradients
          'orange-dim': '#B8610E', // muted orange for secondary text
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      backgroundImage: {
        'orange-gradient': 'linear-gradient(135deg, #FFB74D 0%, #F5921E 50%, #E07010 100%)',
        'purple-gradient': 'linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)',
        'card-gradient':   'linear-gradient(135deg, #251340 0%, #1A0A2E 100%)',
      },
      boxShadow: {
        'orange-glow': '0 0 24px rgba(245, 146, 30, 0.35)',
        'purple-glow': '0 0 24px rgba(91, 33, 182, 0.4)',
        'card':        '0 4px 24px rgba(0, 0, 0, 0.4)',
      },
      animation: {
        'fade-up':    'fadeUp 0.5s ease-out forwards',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;

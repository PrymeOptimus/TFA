import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        hearth: {
          bg: "rgb(var(--hearth-bg) / <alpha-value>)",
          surface: "rgb(var(--hearth-surface) / <alpha-value>)",
          card: "rgb(var(--hearth-card) / <alpha-value>)",
          border: "rgb(var(--hearth-border) / <alpha-value>)",
          text: "rgb(var(--hearth-text) / <alpha-value>)",
          muted: "rgb(var(--hearth-muted) / <alpha-value>)",
          accent: "rgb(var(--hearth-accent) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl2: "1.25rem",
        xl3: "1.75rem",
      },
      boxShadow: {
        soft: "0 8px 30px rgb(0 0 0 / 0.08)",
        card: "0 2px 12px rgb(0 0 0 / 0.06)",
        glow: "0 0 0 1px rgb(var(--hearth-accent) / 0.35), 0 8px 24px rgb(var(--hearth-accent) / 0.25)",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        crossfade: {
          "0%": { opacity: "0" },
          "10%": { opacity: "1" },
          "90%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
      },
      animation: {
        fadeIn: "fadeIn 0.4s ease-out",
        crossfade: "crossfade 30s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;

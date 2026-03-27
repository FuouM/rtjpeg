/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Archivo Black", "sans-serif"],
        mono: ["Roboto Mono", "monospace"],
        sans: ["Roboto Mono", "monospace"],
        oswald: ["Oswald", "sans-serif"],
      },
      colors: {
        surface: "#000000",
        panel: "#0a0a0a",
        border: "#1a1a1a",
        muted: "var(--color-subtitle, #666666)",
        mutedLight: "#999999",
        subtitle: "var(--color-subtitle, #666666)",
        accent: "var(--color-accent, #00ff00)",
        accentDown: "var(--color-accentDown, #ff0000)",
        highlight: "var(--color-highlight, #ffff00)",
        brutalWhite: "#e8e8e8",
        brutalBlack: "#000000",
        concrete: "#cccccc",
      },
      borderWidth: {
        3: "3px",
        brutal: "6px",
      },
      boxShadow: {
        brutal: "8px 8px 0 rgba(0, 0, 0, 1)",
        brutalLight: "8px 8px 0 rgba(0, 0, 0, 0.2)",
      },
    },
  },
  plugins: [],
};

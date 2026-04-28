import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: "#8B5CF6",
        "brand-hover": "#7C3AED",
        cta: "#10B981",
        "cta-hover": "#059669",
      },
      fontFamily: {
        heading: ["var(--font-lora)", "Georgia", "serif"],
        body: ["var(--font-raleway)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;

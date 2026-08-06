import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          muted: "hsl(var(--sidebar-muted))",
          border: "hsl(var(--sidebar-border))",
        },
        // Accent ramp — Apple blue (2026-08-05 re-skin; token name kept so
        // no component changes; was Desert terra).
        terra: {
          50: "#f2f7fd",
          100: "#e3eefb",
          200: "#c2ddf7",
          300: "#93c3f0",
          400: "#4d9ae8",
          500: "#0071e3",
          600: "#0066cc",
          700: "#0055ab",
          800: "#004488",
          900: "#0d3a66",
        },
        // Apple-neutral ramp (2026-08-05 re-skin): sand = surfaces/borders,
        // charcoal = ink. Token names kept so no component changes needed.
        sand: {
          50: "#fbfbfd",
          100: "#f5f5f7",
          200: "#e8e8ed",
          300: "#d2d2d7",
          400: "#aeaeb2",
          500: "#86868b",
          600: "#6e6e73",
          700: "#515154",
          800: "#3a3a3c",
          900: "#2c2c2e",
        },
        charcoal: {
          50: "#f5f5f7",
          100: "#e8e8ed",
          200: "#d2d2d7",
          300: "#aeaeb2",
          400: "#86868b",
          500: "#6e6e73",
          600: "#515154",
          700: "#3a3a3c",
          800: "#2c2c2e",
          900: "#1d1d1f",
          950: "#161617",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.03), 0 8px 24px rgba(0,0,0,0.05)",
        "card-hover": "0 4px 12px rgba(0,0,0,0.05), 0 16px 40px rgba(0,0,0,0.08)",
        "card-active": "0 0 0 2px hsl(20 55% 55% / 0.2)",
        sidebar: "4px 0 24px rgba(0,0,0,0.12)",
        inner: "inset 0 1px 2px rgba(0,0,0,0.06)",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.22, 1, 0.36, 1)",
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
        // Semantic type scale (Wave 1): size-specific tracking (tighter as
        // text grows), leading inversely tracks size, hierarchy = size +
        // weight + leading as a set.
        display: ["2rem", { lineHeight: "2.375rem", letterSpacing: "-0.022em", fontWeight: "700" }],
        title: ["1.375rem", { lineHeight: "1.75rem", letterSpacing: "-0.017em", fontWeight: "600" }],
        heading: ["1rem", { lineHeight: "1.5rem", letterSpacing: "-0.01em", fontWeight: "600" }],
        body: ["0.875rem", { lineHeight: "1.375rem", letterSpacing: "0em", fontWeight: "400" }],
        caption: ["0.75rem", { lineHeight: "1.125rem", letterSpacing: "0.01em", fontWeight: "500" }],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;

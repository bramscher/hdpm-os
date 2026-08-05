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
        // Desert palette direct access
        terra: {
          50: "#fdf3ee",
          100: "#fbe4d6",
          200: "#f5c7ab",
          300: "#efa77a",
          400: "#e88547",
          500: "#d4845a",
          600: "#c4704b",
          700: "#a25439",
          800: "#854634",
          900: "#6d3b2e",
        },
        sand: {
          50: "#faf8f5",
          100: "#f3f0ea",
          200: "#e8e3d9",
          300: "#d5cdc0",
          400: "#b8ad9c",
          500: "#9f9282",
          600: "#857666",
          700: "#6e6154",
          800: "#5c5147",
          900: "#4d443c",
        },
        charcoal: {
          50: "#f4f3f6",
          100: "#e8e6ec",
          200: "#d4d0dc",
          300: "#b5afc3",
          400: "#918aa4",
          500: "#756c89",
          600: "#625974",
          700: "#524a60",
          800: "#464051",
          900: "#2d2a33",
          950: "#1e1b24",
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
        card: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.03)",
        "card-hover": "0 4px 12px rgba(0,0,0,0.06), 0 12px 32px rgba(0,0,0,0.06)",
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
        display: ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "-0.02em", fontWeight: "700" }],
        title: ["1.25rem", { lineHeight: "1.625rem", letterSpacing: "-0.015em", fontWeight: "600" }],
        heading: ["1rem", { lineHeight: "1.5rem", letterSpacing: "-0.01em", fontWeight: "600" }],
        body: ["0.875rem", { lineHeight: "1.375rem", letterSpacing: "0em", fontWeight: "400" }],
        caption: ["0.75rem", { lineHeight: "1.125rem", letterSpacing: "0.01em", fontWeight: "500" }],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;

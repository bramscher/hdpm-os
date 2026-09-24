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
        // Ink ramp — monochrome re-skin (2026-09-24, "HDPM OS"): the accent is
        // black. Token name kept so no component changes (was Apple blue, and
        // Desert terra before that).
        terra: {
          50: "#f7f7f7",
          100: "#efefef",
          200: "#e2e2e2",
          300: "#c7c7c7",
          400: "#5c5c5c",
          500: "#1a1a1a",
          600: "#111111",
          700: "#000000",
          800: "#000000",
          900: "#000000",
        },
        // Pure-neutral ramp (2026-09-24): sand = surfaces/borders, charcoal =
        // ink. No blue tint — crisp black on white.
        sand: {
          50: "#fafafa",
          100: "#f4f4f4",
          200: "#eaeaea",
          300: "#d6d6d6",
          400: "#a8a8a8",
          500: "#8a8a8a",
          600: "#6b6b6b",
          700: "#4f4f4f",
          800: "#363636",
          900: "#262626",
        },
        charcoal: {
          50: "#f4f4f4",
          100: "#eaeaea",
          200: "#d6d6d6",
          300: "#a8a8a8",
          400: "#8a8a8a",
          500: "#6b6b6b",
          600: "#4f4f4f",
          700: "#363636",
          800: "#262626",
          900: "#111111",
          950: "#000000",
        },
        // hdpm-web brand palette — ONLY for the referrer-facing portal
        // (app/partners/(referrer)/**) so external partners match
        // highdesertpm.com. Staff/admin keeps the Desert (sand/charcoal/terra)
        // tokens above. Pure-gray neutrals come from Tailwind's default `neutral-*`.
        brand: {
          green: "#2ECC52",
          greenDark: "#22A840",
          greenLight: "#4ADE6B",
          ink: "#1a1a1a",
          inkDark: "#0f0f0f",
          inkLight: "#2a2a2a",
        },
      },
      fontFamily: {
        // Referrer-portal brand fonts (loaded via next/font in the referrer
        // layout; variables scoped to that route group).
        "brand-heading": ["var(--font-brand-heading)", "system-ui", "sans-serif"],
        "brand-body": ["var(--font-brand-body)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        // Flat, Notion-like elevation: borders do the work, shadows barely there.
        card: "0 1px 2px rgba(0,0,0,0.04)",
        "card-hover": "0 2px 8px rgba(0,0,0,0.06)",
        "card-active": "0 0 0 2px rgba(0,0,0,0.12)",
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

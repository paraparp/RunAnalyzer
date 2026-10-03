import headlessui from '@headlessui/tailwindcss';
import forms from '@tailwindcss/forms';

/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
        "./node_modules/@tremor/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class', // Fix hybrid dark mode issue
    theme: {
        transparent: "transparent",
        current: "currentColor",
        extend: {
            colors: {
                tremor: {
                    brand: {
                        faint: "#e8e6ff", // surface-container
                        muted: "#d8caff", // secondary-container
                        subtle: "#809bff", // primary-container
                        DEFAULT: "#004be2", // primary
                        emphasis: "#001b61", // on-primary-container
                        inverted: "#ffffff", // surface-container-lowest
                    },
                    background: {
                        muted: "#f8f5ff", // background
                        subtle: "#f2efff", // surface-container-low
                        DEFAULT: "#ffffff", // surface-container-lowest
                        emphasis: "#575881", // on-surface-variant
                    },
                    border: {
                        DEFAULT: "transparent", // remove borders to match UI
                    },
                    ring: {
                        DEFAULT: "#809bff", // primary-container
                    },
                    content: {
                        subtle: "#9999c6", // inverse-on-surface
                        DEFAULT: "#575881", // on-surface-variant
                        emphasis: "#2a2b51", // on-surface
                        strong: "#08082f", // inverse-surface
                        inverted: "#ffffff", // surface-container-lowest
                    },
                },
                "dark-tremor": {
                    brand: {
                        faint: "#0B1229",
                        muted: "#172554",
                        subtle: "#1e40af",
                        DEFAULT: "#3b82f6",
                        emphasis: "#60a5fa",
                        inverted: "#030712",
                    },
                    background: {
                        muted: "#131A2B",
                        subtle: "#1f2937",
                        DEFAULT: "#111827",
                        emphasis: "#d1d5db",
                    },
                    border: {
                        DEFAULT: "#374151",
                    },
                    ring: {
                        DEFAULT: "#1f2937",
                    },
                    content: {
                        subtle: "#4b5563",
                        DEFAULT: "#6b7280",
                        emphasis: "#e5e7eb",
                        strong: "#f9fafb",
                        inverted: "#000000",
                    },
                },
            },
            boxShadow: {
                "tremor-input": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
                "tremor-card": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
                "tremor-dropdown": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -1px rgb(0 0 0 / 0.06)",
                "dark-tremor-input": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
                "dark-tremor-card": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
                "dark-tremor-dropdown": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -1px rgb(0 0 0 / 0.06)",
            },
            borderRadius: {
                // Radio global: se controla con --radius en src/index.css
                "tremor-small": "var(--radius)",
                "tremor-default": "var(--radius)",
                "tremor-full": "9999px",
                "DEFAULT": "var(--radius)",
                "sm": "var(--radius)",
                "md": "var(--radius)",
                "lg": "var(--radius)",
                "xl": "var(--radius)",
                "2xl": "var(--radius)",
                "3xl": "var(--radius)",
                "full": "0.75rem",
            },
            fontFamily: {
                "headline": ["Inter"],
                "body": ["Inter"],
                "label": ["Inter"],
            },
            fontSize: {
                // Etiqueta en mayúsculas (cabeceras de dato, chips, encabezados de tabla):
                // 11px es el suelo legible para versales; en minúscula el mínimo es text-xs.
                "label": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.06em" }],
                "tremor-label": ["0.75rem", { lineHeight: "1rem" }],
                "tremor-default": ["0.875rem", { lineHeight: "1.25rem" }],
                "tremor-title": ["1.125rem", { lineHeight: "1.75rem" }],
                "tremor-metric": ["1.875rem", { lineHeight: "2.25rem" }],
            },
        },
    },
    safelist: [
        {
            pattern:
                /^(bg-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
            variants: ["hover", "ui-selected"],
        },
        {
            pattern:
                /^(text-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
            variants: ["hover", "ui-selected"],
        },
        {
            pattern:
                /^(border-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
            variants: ["hover", "ui-selected"],
        },
        {
            pattern:
                /^(ring-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
        },
        {
            pattern:
                /^(stroke-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
        },
        {
            pattern:
                /^(fill-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
        },
    ],
    plugins: [headlessui, forms],
};

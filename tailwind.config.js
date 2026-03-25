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
                "on-secondary-container": "#5000d2",
                "primary-container": "#809bff",
                "background": "#f8f5ff",
                "primary-dim": "#0041c7",
                "primary-fixed-dim": "#6c8cff",
                "secondary-fixed": "#d8caff",
                "inverse-on-surface": "#9999c6",
                "on-primary": "#f2f1ff",
                "on-tertiary-container": "#004d57",
                "tertiary-dim": "#005863",
                "surface-variant": "#dbd9ff",
                "tertiary-container": "#00e3fd",
                "error-dim": "#a70138",
                "on-secondary": "#f7f0ff",
                "tertiary": "#006571",
                "surface-container": "#e8e6ff",
                "error": "#b41340",
                "surface-container-lowest": "#ffffff",
                "surface-dim": "#d1d0ff",
                "surface-tint": "#004be2",
                "outline-variant": "#a9a9d7",
                "on-primary-container": "#001b61",
                "secondary": "#652fe7",
                "on-tertiary-fixed": "#003840",
                "on-primary-fixed": "#000000",
                "on-primary-fixed-variant": "#002376",
                "surface-container-low": "#f2efff",
                "outline": "#72739e",
                "on-error": "#ffefef",
                "error-container": "#f74b6d",
                "on-surface-variant": "#575881",
                "surface-bright": "#f8f5ff",
                "primary-fixed": "#809bff",
                "on-background": "#2a2b51",
                "inverse-surface": "#08082f",
                "surface-container-highest": "#dbd9ff",
                "surface": "#f8f5ff",
                "secondary-container": "#d8caff",
                "on-secondary-fixed-variant": "#591bdc",
                "secondary-dim": "#5819db",
                "tertiary-fixed-dim": "#00d4ec",
                "on-error-container": "#510017",
                "primary": "#004be2",
                "on-secondary-fixed": "#3b00a0",
                "surface-container-high": "#e1e0ff",
                "on-surface": "#2a2b51",
                "secondary-fixed-dim": "#cabaff",
                "tertiary-fixed": "#00e3fd",
                "inverse-primary": "#6889ff",
                "on-tertiary-fixed-variant": "#005762",
                "on-tertiary": "#d8f8ff",
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
                "tremor-small": "0.375rem",
                "tremor-default": "0.5rem",
                "tremor-full": "9999px",
                "DEFAULT": "0.125rem",
                "lg": "0.25rem",
                "xl": "0.5rem",
                "full": "0.75rem",
            },
            fontFamily: {
                "headline": ["Inter"],
                "body": ["Inter"],
                "label": ["Inter"],
            },
            fontSize: {
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
    plugins: [require("@headlessui/tailwindcss"), require("@tailwindcss/forms")],
};

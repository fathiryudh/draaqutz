import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        charcoal: "#11100e",
        ink: "#1b1916",
        bone: "#f4efe7",
        paper: "#fbf8f2",
        copper: "#b46a3c"
      },
      fontFamily: {
        sans: ["Outfit", "Avenir Next", "system-ui", "sans-serif"],
        display: ["Outfit", "Avenir Next", "system-ui", "sans-serif"]
      },
      transitionTimingFunction: {
        heavy: "cubic-bezier(0.32,0.72,0,1)"
      }
    }
  },
  plugins: []
};

export default config;

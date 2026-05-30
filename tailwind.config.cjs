/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "SF Pro Display", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#f1f7ff",
          100: "#d9e9ff",
          500: "#4f8cff",
          700: "#2f5df4",
          900: "#1d2a5f",
        },
      },
      boxShadow: {
        glass: "0 20px 60px rgba(0, 0, 0, 0.15)",
      },
    },
  },
  plugins: [],
};

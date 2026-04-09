/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}", "./index.html"],
  theme: {
    extend: {
      colors: {
        unity: {
          bg: '#282828',
          'bg-alt': '#303030',
          'bg-header': '#3C3C3C',
          'bg-toolbar': '#383838',
          'bg-dark': '#191919',
          'bg-hover': '#464646',
          'bg-selected': '#46607C',
          border: '#232323',
          'border-btn': '#303030',
          text: '#D2D2D2',
          'text-bright': '#EEEEEE',
          'text-dim': '#7A7A7A',
          'text-tiny': '#585858',
          btn: '#585858',
          'btn-hover': '#676767',
          blue: '#7BAEFA',
          green: '#58B258',
          red: '#D32222',
          orange: '#E8A04C',
          purple: '#B07ACC',
          cyan: '#5AAFAF',
        }
      },
      fontSize: {
        'unity-tiny': '9px',
        'unity-sm': '10px',
        'unity-base': '11px',
        'unity-md': '12px',
        'unity-lg': '13px',
      },
      borderRadius: {
        'unity': '3px',
      },
      spacing: {
        'unity-row': '18px',
        'unity-row-lg': '20px',
        'unity-toolbar': '21px',
        'unity-icon': '16px',
      }
    },
  },
  plugins: [require("tailwindcss-animate")],
}

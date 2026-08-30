/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      /**
       * Colour extensions that map to the CSS custom properties defined in
       * index.css. This lets Tailwind utilities like bg-status-running and
       * text-severity-high work alongside the arbitrary-value syntax.
       */
      colors: {
        'status-pending':   'var(--status-pending)',
        'status-running':   'var(--status-running)',
        'status-completed': 'var(--status-completed)',
        'status-failed':    'var(--status-failed)',
        'status-cancelled': 'var(--status-cancelled)',

        'severity-critical': 'var(--severity-critical)',
        'severity-high':     'var(--severity-high)',
        'severity-medium':   'var(--severity-medium)',
        'severity-low':      'var(--severity-low)',
        'severity-info':     'var(--severity-info)',

        sidebar:  'var(--color-sidebar)',
        surface:  'var(--color-surface)',
        border:   'var(--color-border)',
        accent:   'var(--color-accent)',
      },

      /**
       * Sidebar width token — ensures the main content margin is always
       * in sync with the sidebar width without magic numbers in components.
       */
      width: {
        sidebar: '200px',
      },
      marginLeft: {
        sidebar: '200px',
      },
    },
  },
  plugins: [],
};

// Generated from Margin tokens.json by @carrel/margin. Do not edit; run `pnpm --filter @carrel/margin tokens`.

export const tokens = {
  "colors": {
    "mat": {
      "day": "#cfd8d1",
      "night": "#121a17"
    },
    "mat-line": {
      "day": "#bcc7bf",
      "night": "#1f2b26"
    },
    "paper": {
      "day": "#fcfcf9",
      "night": "#232829"
    },
    "paper-2": {
      "day": "#f1f3ee",
      "night": "#2c3233"
    },
    "rule": {
      "day": "#e2e5df",
      "night": "#363c3d"
    },
    "ink": {
      "day": "#1b1f24",
      "night": "#e8ebe7"
    },
    "ink-muted": {
      "day": "#59616a",
      "night": "#a5aca8"
    },
    "margin-line": {
      "day": "#df7377",
      "night": "#b9585c"
    },
    "pencil": {
      "day": "#2457c5",
      "night": "#8fb2ff"
    },
    "pencil-wash": {
      "day": "#e8efff",
      "night": "#26314a"
    },
    "highlight": {
      "day": "#ffe14d",
      "night": "#e8c835"
    },
    "highlight-ink": {
      "day": "#1b1f24",
      "night": "#1b1f24"
    },
    "highlight-soft": {
      "day": "#fff2a8",
      "night": "#4b4320"
    },
    "graphite": {
      "day": "#7f878e",
      "night": "#7a8388"
    },
    "focus": {
      "day": "#1b1f24",
      "night": "#e8ebe7"
    },
    "success": {
      "day": "#2c7a4b",
      "night": "#72cf98"
    },
    "warning": {
      "day": "#9a5800",
      "night": "#f1b55c"
    },
    "danger": {
      "day": "#b3261e",
      "night": "#f2867e"
    }
  },
  "typeStyles": {
    "display": {
      "family": "read",
      "fontSize": "56px",
      "lineHeight": "60px",
      "fontWeight": 500,
      "letterSpacing": "-0.5px"
    },
    "title": {
      "family": "read",
      "fontSize": "28px",
      "lineHeight": "34px",
      "fontWeight": 500
    },
    "heading": {
      "family": "ui",
      "fontSize": "18px",
      "lineHeight": "24px",
      "fontWeight": 600
    },
    "body": {
      "family": "ui",
      "fontSize": "15px",
      "lineHeight": "22px",
      "fontWeight": 400
    },
    "label": {
      "family": "ui",
      "fontSize": "13px",
      "lineHeight": "18px",
      "fontWeight": 500
    },
    "caption": {
      "family": "ui",
      "fontSize": "12px",
      "lineHeight": "16px",
      "fontWeight": 400
    },
    "reading": {
      "family": "read",
      "fontSize": "19px",
      "lineHeight": "31px",
      "fontWeight": 400
    },
    "marginalia": {
      "family": "read",
      "fontSize": "15px",
      "lineHeight": "22px",
      "fontWeight": 400,
      "fontStyle": "italic"
    },
    "position": {
      "family": "mono",
      "fontSize": "12px",
      "lineHeight": "16px",
      "fontWeight": 500
    }
  },
  "spacing": {
    "space-1": "4px",
    "space-2": "8px",
    "space-3": "12px",
    "space-4": "16px",
    "space-6": "24px",
    "space-8": "32px",
    "space-12": "48px"
  },
  "radius": {
    "radius-mark": "2px",
    "radius-sheet": "4px",
    "radius-control": "8px",
    "radius-seat": "999px"
  }
} as const

export type ColorToken = keyof typeof tokens.colors
export type TypeStyle = keyof typeof tokens.typeStyles

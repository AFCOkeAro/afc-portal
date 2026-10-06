/**
 * AFC Design System — Tailwind preset (and Nuxt UI colour bridge).
 *
 * The system is CSS-custom-property-first because most AFC surfaces have no build
 * step: docker/landing/, wp-content/, church-records/, cloudup-ppt/ and flyers/ are
 * plain HTML/PHP, and convox/frontend is hand-rolled CSS with no framework at all.
 * This preset is the *adapter* for surfaces that do choose Tailwind (the Church
 * Portal's Nuxt 3 frontend is the first). It maps onto the same tokens; it does not
 * introduce a second source of truth.
 *
 * Nuxt UI usage — nuxt.config.ts:
 *
 *   import afcPreset from './design-system/adapters/tailwind-preset.js'
 *   export default defineNuxtConfig({
 *     modules: ['@nuxt/ui'],
 *     css: ['~/design-system/tokens/afc-tokens.css',
 *           '~/design-system/components/afc-components.css'],
 *     ui: { colors: { primary: 'azure', neutral: 'slate' } },
 *     tailwindcss: { cssPath: '~/design-system/adapters/tailwind.css', config: { presets: [afcPreset()] } },
 *   })
 *
 * Then swap the palette in one line — see NUXT_UI_COLOR below — and Nuxt UI buttons,
 * fields, badges, modals and tables inherit the AFC palette and radii.
 *
 * IMPORTANT: Nuxt UI ships its own semantic colour names (primary, success, warning,
 * error, neutral). Point them at the AFC primitives below ONCE, in config. Do not
 * restyle Nuxt UI components with ad-hoc classes; that is how a design system dies.
 */

export default function afcPreset() {
  return {
    theme: {
      extend: {
        colors: {
          afc: {
            ink: {
              50: 'var(--afc-ink-50)',
              100: 'var(--afc-ink-100)',
              200: 'var(--afc-ink-200)',
              300: 'var(--afc-ink-300)',
              400: 'var(--afc-ink-400)',
              500: 'var(--afc-ink-500)',
              600: 'var(--afc-ink-600)',
              700: 'var(--afc-ink-700)',
              800: 'var(--afc-ink-800)',
              900: 'var(--afc-ink-900)',
              950: 'var(--afc-ink-950)',
            },
            paper: {
              0: 'var(--afc-paper-0)',
              25: 'var(--afc-paper-25)',
              50: 'var(--afc-paper-50)',
              100: 'var(--afc-paper-100)',
              200: 'var(--afc-paper-200)',
              300: 'var(--afc-paper-300)',
            },
            // Brand seal. Graphic use only — gold is 1.71:1 on white and is never
            // valid as text or as a button fill with white type. See docs §3.
            gold: {
              200: 'var(--afc-gold-200)',
              300: 'var(--afc-gold-300)',
              400: 'var(--afc-gold-400)',
              500: 'var(--afc-gold-500)',
              600: 'var(--afc-gold-600)',
              700: 'var(--afc-gold-700)',
            },
            // Brand seal, deep blue. Named at the brand owner's request: this is a
            // deep blue, not purple. Measured H 252-253. See docs §3.3.
            blue: {
              200: 'var(--afc-blue-200)',
              400: 'var(--afc-blue-400)',
              500: 'var(--afc-blue-500)',
              600: 'var(--afc-blue-600)',
              700: 'var(--afc-blue-700)',
              800: 'var(--afc-blue-800)',
            },
            action: {
              300: 'var(--afc-action-300)',
              400: 'var(--afc-action-400)',
              500: 'var(--afc-action-500)',
              600: 'var(--afc-action-600)',
              700: 'var(--afc-action-700)',
              800: 'var(--afc-action-800)',
            },
            status: {
              danger: 'var(--afc-status-danger)',
              'danger-bg': 'var(--afc-status-danger-bg)',
              success: 'var(--afc-status-success)',
              'success-bg': 'var(--afc-status-success-bg)',
              warn: 'var(--afc-status-warn)',
              'warn-bg': 'var(--afc-status-warn-bg)',
              info: 'var(--afc-status-info)',
              'info-bg': 'var(--afc-status-info-bg)',
              neutral: 'var(--afc-status-neutral)',
              'neutral-bg': 'var(--afc-status-neutral-bg)',
            },
            // Department accents. These are FAMILY TINTS, not identity keys:
            // three marks share gold and two share deep blue, so a control that
            // switches department must show the seal and the name, never the
            // hue alone (WCAG 1.4.1). See docs/DESIGN_SYSTEM.md §3.4.
            dept: {
              afc: 'var(--afc-dept-afc-accent)',
              weca: 'var(--afc-dept-weca-accent)',
              afcmf: 'var(--afc-dept-afcmf-accent)',
              afcf: 'var(--afc-dept-afcf-accent)',
              afc4c: 'var(--afc-dept-afc4c-accent)',
              ydd: 'var(--afc-dept-ydd-accent)',
            },
            'dept-ink': {
              afc: 'var(--afc-dept-afc-ink)',
              weca: 'var(--afc-dept-weca-ink)',
              afcmf: 'var(--afc-dept-afcmf-ink)',
              afcf: 'var(--afc-dept-afcf-ink)',
              afc4c: 'var(--afc-dept-afc4c-ink)',
              ydd: 'var(--afc-dept-ydd-ink)',
            },
          },
          // Nuxt UI's semantic names, bridged onto AFC tokens. This is the only
          // place the two vocabularies meet.
          primary: 'var(--afc-bg-action)',
          success: 'var(--afc-status-success)',
          warning: 'var(--afc-status-warn)',
          error: 'var(--afc-status-danger)',
          neutral: 'var(--afc-ink-400)',
        },

        fontFamily: {
          sans: ['var(--afc-font-sans)'],
          serif: ['var(--afc-font-serif)'],
          read: ['var(--afc-font-read)'],
          mono: ['var(--afc-font-mono)'],
        },

        fontSize: {
          '2xs': ['var(--afc-text-2xs)', { lineHeight: '1.5' }],
          xs: ['var(--afc-text-xs)', { lineHeight: '1.5' }],
          sm: ['var(--afc-text-sm)', { lineHeight: '1.5' }],
          base: ['var(--afc-text-base)', { lineHeight: '1.5' }],
          md: ['var(--afc-text-md)', { lineHeight: '1.5' }],
          lg: ['var(--afc-text-lg)', { lineHeight: '1.25' }],
          xl: ['var(--afc-text-xl)', { lineHeight: '1.25' }],
          '2xl': ['var(--afc-text-2xl)', { lineHeight: '1.1' }],
          '3xl': ['var(--afc-text-3xl)', { lineHeight: '1.1' }],
          '4xl': ['var(--afc-text-4xl)', { lineHeight: '1.1' }],
        },

        // One block, not two. DEFAULT is the pill because every Nuxt UI control
        // inherits it; naming a second borderRadius key would silently drop the
        // first. Explicit md/lg stay near-square for containers.
        borderRadius: {
          xs: 'var(--afc-radius-xs)',
          sm: 'var(--afc-radius-sm)',
          DEFAULT: 'var(--afc-radius-pill)',
          md: 'var(--afc-radius-md)',
          lg: 'var(--afc-radius-lg)',
          xl: 'var(--afc-radius-xl)',
          '2xl': 'var(--afc-radius-xl)',
          '3xl': 'var(--afc-radius-xl)',
          pill: 'var(--afc-radius-pill)',
          full: 'var(--afc-radius-full)',
        },

        boxShadow: {
          xs: 'var(--afc-shadow-xs)',
          sm: 'var(--afc-shadow-sm)',
          md: 'var(--afc-shadow-md)',
          lg: 'var(--afc-shadow-lg)',
          focus: 'var(--afc-shadow-focus)',
        },

        transitionTimingFunction: {
          // The AFC signature curve, measured 58x in production CSS.
          afc: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          out: 'cubic-bezier(0.16, 1, 0.3, 1)',
          spring: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
        },

        transitionDuration: {
          instant: 'var(--afc-dur-instant)',
          fast: 'var(--afc-dur-fast)',
          feedback: 'var(--afc-dur-feedback)',
          base: 'var(--afc-dur-base)',
          slow: 'var(--afc-dur-slow)',
          deliberate: 'var(--afc-dur-deliberate)',
        },

        letterSpacing: {
          label: 'var(--afc-track-label)',
          button: 'var(--afc-track-button)',
          tight: 'var(--afc-track-tight)',
        },

        spacing: {
          1: 'var(--afc-space-1)', 2: 'var(--afc-space-2)', 3: 'var(--afc-space-3)',
          4: 'var(--afc-space-4)', 5: 'var(--afc-space-5)', 6: 'var(--afc-space-6)',
          7: 'var(--afc-space-7)', 8: 'var(--afc-space-8)', 9: 'var(--afc-space-9)',
        },

        maxWidth: { afc: 'var(--afc-content-max)', measure: 'var(--afc-content-measure)' },

        zIndex: {
          afcSticky: 'var(--afc-z-sticky)',
          afcTopbar: 'var(--afc-z-topbar)',
          afcDrawer: 'var(--afc-z-drawer)',
          afcModal: 'var(--afc-z-modal)',
          afcToast: 'var(--afc-z-toast)',
        },
      },
    },
  };
}

/** Minimum interactive size. WCAG 2.2 AA 2.5.8 floor is 24px; AFC holds 44px. */
export const AFC_CONTROL_MIN = 'var(--afc-control-min)';
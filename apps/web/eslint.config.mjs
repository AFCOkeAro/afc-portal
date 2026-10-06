// ESLint flat config for the portal.
//
// The generated Nuxt config supplies the TypeScript, Vue and Nuxt rules;
// `eslint-config-prettier` is appended last so that formatting disagreements
// are reported by `prettier --check` rather than fighting the stylistic rules.
// Two lint jobs that disagree about the same line is a way to get both disabled.
import withNuxt from './.nuxt/eslint.config.mjs'
import eslintConfigPrettier from 'eslint-config-prettier'

export default withNuxt({
  rules: {
    'vue/multi-word-component-names': 'off',
  },
}).append(eslintConfigPrettier)
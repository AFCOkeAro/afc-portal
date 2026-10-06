<script setup lang="ts">
import { ApiRequestError } from '~/composables/useApi'

/**
 * Sign in.
 *
 * The form is the only thing on this page that is not shell: it posts to
 * `/api/auth/login`, which is a real route. Until Directus is deployed it will
 * answer 503 unless `NUXT_STUB_AUTH=true`, and the message says which.
 */
definePageMeta({ layout: 'auth' })

const route = useRoute()
const auth = useAuth()

const email = ref('')
const password = ref('')
const submitting = ref(false)
const errorMessage = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})

const redirectTo = computed(() => {
  const value = route.query.redirect
  return typeof value === 'string' && value.startsWith('/') ? value : '/dashboard'
})

async function submit() {
  submitting.value = true
  errorMessage.value = null
  fieldErrors.value = {}
  try {
    await auth.login({ email: email.value, password: password.value })
    await navigateTo(redirectTo.value, { replace: true })
  } catch (cause) {
    if (cause instanceof ApiRequestError) {
      // 503 here means the Directus project is not deployed, which is the state
      // of this repository today. Say that rather than "sign-in failed", which
      // would send a developer looking at their own password.
      errorMessage.value =
        cause.status === 503
          ? 'Sign-in is not available yet: the Directus project has not been deployed. Set NUXT_STUB_AUTH=true to use the local stub identities.'
          : cause.message
      fieldErrors.value = cause.fields
    } else {
      errorMessage.value = 'Sign-in failed unexpectedly.'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UCard>
    <h2 class="text-base font-semibold">Sign in</h2>
    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
      Staff and volunteer accounts only.
    </p>

    <form class="mt-6 space-y-4" novalidate @submit.prevent="submit">
      <UFormField label="Email address" name="email" required :error="fieldErrors.email">
        <UInput
          v-model="email"
          type="email"
          name="email"
          autocomplete="username"
          required
          class="w-full"
          placeholder="you@apostolicfaith.org"
        />
      </UFormField>

      <UFormField label="Password" name="password" required :error="fieldErrors.password">
        <UInput
          v-model="password"
          type="password"
          name="password"
          autocomplete="current-password"
          required
          class="w-full"
        />
      </UFormField>

      <UAlert
        v-if="errorMessage"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :description="errorMessage"
        role="alert"
      />

      <UButton
        type="submit"
        block
        :loading="submitting"
        label="Sign in"
        trailing-icon="i-lucide-arrow-right"
      />
    </form>

    <USeparator class="my-5" label="or" />

    <p class="text-center text-sm text-gray-500 dark:text-gray-400">
      Registering for an event?
      <NuxtLink
        to="/register"
        class="font-medium text-primary-600 hover:underline dark:text-primary-400"
      >
        Use the public form
      </NuxtLink>
    </p>
  </UCard>
</template>

<script setup lang="ts">
/**
 * Landing route.
 *
 * Decides once, then redirects: to the dashboard for a session, to sign-in
 * otherwise. It renders nothing on purpose — a route whose only job is to
 * redirect should not paint a frame first, and on the server a redirect thrown
 * during setup means the browser never receives the intermediate HTML at all.
 */
const auth = useAuth()

await auth.ensureSession()

await navigateTo(auth.isAuthenticated.value ? '/dashboard' : '/login', {
  replace: true,
})
</script>

<template>
  <div />
</template>

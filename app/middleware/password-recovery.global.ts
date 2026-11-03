export default defineNuxtRouteMiddleware(to => {
  // Some email configurations fall back to the site root. Keep recovery sessions
  // on the password screen; the SDK remains responsible for validating the session.
  const recovery = useState('account-password-recovery', () => false)
  if (recovery.value && to.path !== '/login') return navigateTo('/login?mode=recovery', { replace: true })
})

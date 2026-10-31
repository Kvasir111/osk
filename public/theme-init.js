// Apply the saved/device theme before the app paints. Storage may be disabled.
;(function () {
  var saved
  try { saved = localStorage.getItem('osk-theme') } catch (_) {}
  var dark = saved === 'dark' || (saved !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
})()

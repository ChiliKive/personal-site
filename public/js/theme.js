/* Apply the saved theme before first paint (no flash). */
(function () {
  try {
    var t = new URLSearchParams(location.search).get('theme') || localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();

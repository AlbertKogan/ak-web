// Skip-link focus management
if (document.querySelector) {
  const skipLink = document.querySelector(".skip-link");
  if (skipLink) {
    skipLink.addEventListener("click", (e) => {
      const target = document.querySelector(skipLink.getAttribute("href"));
      if (target) {
        target.setAttribute("tabindex", "-1");
        target.focus();
      }
    });
  }
}

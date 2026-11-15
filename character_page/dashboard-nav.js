(() => {
  const header = document.querySelector("[data-dashboard-page]");
  const storyPage = header.dataset.dashboardPage === "maps"
    && new URLSearchParams(location.search).get("map") === "intro";
  const pages = [
    ["characters", "Characters", "../character_page/"],
    ["party", "Party actions", "../session_page/"],
    ["keep", "Keep", "../keep_page/"],
    ["maps", "Maps", "../adventure_page/?map=wilderness"],
    ["combat", "Combat", "../combat_page/"],
    ["library", "Library", "../library_page/"],
  ];
  const tabs = pages.map(([key, name, href]) =>
    `<a href="${href}"${!storyPage && key === header.dataset.dashboardPage ? ' aria-current="page"' : ""}>${name}</a>`
  ).join("") + (storyPage
    ? '<a href="../adventure_page/?map=intro" aria-current="page">Story Mode</a>'
    : '<a href="../adventure_page/?map=intro" target="borderlands-story" data-story-window>Story Mode ↗</a>');
  header.innerHTML = `<div class="masthead-inner">
    <div class="wordmark"><span class="brand-mark" aria-hidden="true">✦</span><span>Borderlands<small>DM companion</small></span></div>
    <nav class="dashboard-tabs" aria-label="DM companion">${tabs}</nav>
    <div class="dashboard-history" data-dashboard-history></div>
    <div class="language" role="group" aria-label="Content language">
      <button id="lang-en" type="button" aria-pressed="true">English</button>
      <button id="lang-zh" type="button" aria-pressed="false" lang="zh-Hans">简体中文</button>
    </div>
  </div>`;

  header.querySelector("[data-story-window]")?.addEventListener("click", event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const popup = window.open("", "borderlands-story", "popup,width=1120,height=840");
    if (!popup) return;
    event.preventDefault();
    const storyURL = new URL(event.currentTarget.href);
    try {
      if (popup.location.pathname !== storyURL.pathname || new URLSearchParams(popup.location.search).get("map") !== "intro") {
        popup.location.href = storyURL.href;
      }
    } catch {
      popup.location.href = storyURL.href;
    }
    popup.focus();
  });

  const updateHeight = () => document.documentElement.style.setProperty("--dashboard-header-height", `${header.offsetHeight}px`);
  updateHeight();
  new ResizeObserver(updateHeight).observe(header);
})();

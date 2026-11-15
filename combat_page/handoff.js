(() => {
  const slug = value => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
  const integer = (value, min, max) => Number.isInteger(value) && min <= value && value <= max;
  const pair = value => typeof value === "string" || Array.isArray(value)
    && value.length === 2 && value.every(text => typeof text === "string");

  function url({ title, groups, back, rule }) {
    const params = new URLSearchParams({ encounter: JSON.stringify({ title, groups, back, rule }) });
    return `../combat_page/?${params}`;
  }

  function read() {
    const value = new URLSearchParams(location.search).get("encounter");
    if (!value || value === "ambush" || value.length > 12000) return null;
    try {
      const data = JSON.parse(value);
      if (!pair(data.title) || !Array.isArray(data.groups) || !data.groups.length || data.groups.length > 32
        || !data.groups.every(group => slug(group.id) && integer(group.count, 1, 64)
          && integer(group.hp, 1, 9999) && (group.ac == null || integer(group.ac, 0, 999))
          && (group.name == null || pair(group.name)) && (group.note == null || pair(group.note)))
        || !backURL(data.back)) return null;
      return data;
    } catch {
      return null;
    }
  }

  function backURL(value) {
    if (typeof value !== "string" || !/^\.\.\/(adventure_page|keep_page)\/\?/.test(value)) return null;
    const url = new URL(value, location.href);
    return url.origin === location.origin && ["/adventure_page/", "/keep_page/"].includes(url.pathname)
      ? `${url.pathname}${url.search}` : null;
  }

  globalThis.combatHandoff = { url, read, backURL };
})();

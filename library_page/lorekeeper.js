(() => {
  "use strict";

  if (document.getElementById("lorekeeper-panel")) return;

  const historyKey = "borderlands:lorekeeper:history";
  const panelKey = "borderlands:lorekeeper:panel";
  const docked = window.matchMedia("(min-width: 1220px)");
  const questionLimit = 600;
  const savedTurnLimit = 12;
  const contextTurnLimit = 4;
  const sourceLimit = 8;

  function readSession(key) {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? "null");
    } catch {
      return null;
    }
  }

  function writeSession(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The panel still works when session storage is unavailable.
    }
  }

  function create(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content) node.textContent = content;
    return node;
  }

  function button(className, label) {
    const node = create("button", className, label);
    node.type = "button";
    return node;
  }

  function normalizeSource(source, index) {
    if (typeof source?.title !== "string" || typeof source.url !== "string") return null;
    try {
      const url = new URL(source.url, `${window.location.origin}/`);
      const allowed = url.pathname === "/library_page/" ||
        /^\/database\/(records|sources)\/.+\.(md|pdf)$/i.test(url.pathname);
      if (!allowed || url.origin !== window.location.origin || url.username || url.password) return null;
      const title = source.title.trim().slice(0, 160);
      const position = Number.isInteger(source.position) && source.position >= 1 && source.position <= sourceLimit
        ? source.position : index + 1;
      return title ? { title, url: `${url.pathname}${url.search}${url.hash}`, position } : null;
    } catch {
      return null;
    }
  }

  function normalizeTurn(turn) {
    if (typeof turn?.question !== "string" || typeof turn.answer !== "string") return null;
    const question = turn.question.trim().slice(0, questionLimit);
    const answer = turn.answer.trim().slice(0, 6000);
    if (!question || !answer || !["local", "ai"].includes(turn.mode)) return null;
    const sources = Array.isArray(turn.sources)
      ? turn.sources.slice(0, sourceLimit).map(normalizeSource).filter(Boolean)
      : [];
    const availability = ["online", "no-key", "provider-unavailable", "no-match", "conversation"].includes(turn.availability)
      ? turn.availability : "";
    return { question, answer, sources, mode: turn.mode, availability };
  }

  function readHistory() {
    const stored = readSession(historyKey);
    return Array.isArray(stored) ? stored.slice(-savedTurnLimit).map(normalizeTurn).filter(Boolean) : [];
  }

  function readPanelPreference() {
    const stored = readSession(panelKey);
    return { dock: stored?.dock !== false, drawer: stored?.drawer === true };
  }

  let history = readHistory();
  let panelPreference = readPanelPreference();
  let pending = false;
  let composing = false;

  const panel = create("aside", "lorekeeper-panel");
  panel.id = "lorekeeper-panel";
  panel.lang = "zh-Hans";
  panel.setAttribute("aria-labelledby", "lorekeeper-title");
  const launcher = button("lorekeeper-launch", "Lorekeeper");
  launcher.setAttribute("aria-controls", panel.id);

  const header = create("header", "lorekeeper-header");
  const title = create("h2", "", "Lorekeeper");
  title.id = "lorekeeper-title";
  title.lang = "en";
  const controls = create("div", "lorekeeper-controls");
  const clear = button("lorekeeper-quiet", "清空");
  clear.setAttribute("aria-label", "清空问答记录");
  const close = button("lorekeeper-close", "×");
  close.setAttribute("aria-label", "收起典籍守护者");
  controls.append(clear, close);
  header.append(title, controls);

  const transcript = create("div", "lorekeeper-transcript");
  transcript.setAttribute("role", "log");
  transcript.setAttribute("aria-label", "问答记录");
  transcript.tabIndex = 0;
  const intro = create("p", "lorekeeper-intro", "您来了。想查哪条规则，还是想商量桌上遇到的事？");
  const form = create("form", "lorekeeper-form");
  const label = create("label", "", "询问典籍守护者");
  label.htmlFor = "lorekeeper-question";
  const questionInput = create("textarea", "lorekeeper-question");
  questionInput.id = label.htmlFor;
  questionInput.maxLength = questionLimit;
  questionInput.rows = 3;
  questionInput.required = true;
  questionInput.placeholder = "例如：0 HP 后还能做什么？稳定与治疗有什么区别？";
  const keyboardHint = create("p", "lorekeeper-keyboard-hint", "Enter 发送 · Shift+Enter 换行");
  keyboardHint.id = "lorekeeper-keyboard-hint";
  questionInput.setAttribute("aria-describedby", keyboardHint.id);
  const submit = create("button", "lorekeeper-submit", "询问");
  submit.type = "submit";
  const status = create("p", "lorekeeper-status");
  status.setAttribute("role", "status");
  const footer = create("div", "lorekeeper-footer");
  footer.append(status, submit);
  form.append(label, questionInput, keyboardHint, footer);
  panel.append(header, transcript, form);

  function drawTurn(turn) {
    const article = create("article", "lorekeeper-turn");
    const question = create("p", "lorekeeper-user", turn.question);
    question.lang = "";
    question.dir = "auto";
    const reply = create("div", "lorekeeper-reply");
    const modeLabels = {
      online: "典籍守护者 · 在线问答",
      "no-key": "本地资料答复 · 在线问答未启用",
      "provider-unavailable": "本地资料答复 · 在线服务暂不可用",
      "no-match": "本地资料查询",
      conversation: "典籍守护者",
    };
    const mode = create("span", "lorekeeper-mode", modeLabels[turn.availability]
      ?? (turn.mode === "ai" ? "AI 顾问 · 本地图书馆依据" : "本地资料答复"));
    reply.append(mode, create("p", "lorekeeper-answer", turn.answer));
    if (turn.sources.length) {
      const sources = create("ol", "lorekeeper-sources");
      sources.setAttribute("aria-label", "资料来源");
      for (const source of turn.sources) {
        const row = create("li");
        row.value = source.position;
        const link = create("a", "", source.title);
        link.href = source.url;
        row.append(link);
        sources.append(row);
      }
      reply.append(sources);
    }
    article.append(question, reply);
    transcript.append(article);
  }

  function scrollToLatest() {
    transcript.scrollTop = transcript.scrollHeight;
  }

  function updatePanel() {
    const open = docked.matches ? panelPreference.dock : panelPreference.drawer;
    panel.hidden = !open;
    launcher.hidden = open;
    launcher.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("lorekeeper-docked", open && docked.matches);
    if (open) scrollToLatest();
  }

  function setOpen(open) {
    panelPreference[docked.matches ? "dock" : "drawer"] = open;
    writeSession(panelKey, panelPreference);
    updatePanel();
    (open ? questionInput : launcher).focus();
  }

  function syncControls() {
    clear.hidden = !history.length;
    clear.disabled = pending;
    submit.disabled = pending;
    submit.textContent = pending ? "查询中…" : "询问";
  }

  function drawHistory() {
    transcript.replaceChildren();
    if (history.length) history.forEach(drawTurn);
    else transcript.append(intro);
  }

  drawHistory();
  document.body.append(launcher, panel);
  updatePanel();
  syncControls();

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    history = readHistory();
    panelPreference = readPanelPreference();
    drawHistory();
    updatePanel();
    syncControls();
  });
  docked.addEventListener("change", updatePanel);
  launcher.addEventListener("click", () => setOpen(true));
  close.addEventListener("click", () => setOpen(false));
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  });
  clear.addEventListener("click", () => {
    if (pending) return;
    history.length = 0;
    writeSession(historyKey, history);
    transcript.replaceChildren(intro);
    status.textContent = "已清空问答记录。";
    syncControls();
    questionInput.focus();
  });
  questionInput.addEventListener("input", () => questionInput.setCustomValidity(""));
  questionInput.addEventListener("compositionstart", () => { composing = true; });
  questionInput.addEventListener("compositionend", () => { composing = false; });
  questionInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || composing || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!pending && !event.repeat) form.requestSubmit(submit);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending) return;
    const draft = questionInput.value;
    const question = draft.trim();
    if (!question) {
      questionInput.setCustomValidity("请输入问题。");
      questionInput.reportValidity();
      return;
    }
    pending = true;
    status.textContent = "正在翻阅资料…";
    syncControls();

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch("/api/lorekeeper/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
        body: JSON.stringify({
          question,
          history: history.slice(-contextTurnLimit).map(({ question, answer }) => ({
            question,
            answer: answer.slice(0, 1400),
          })),
        }),
      });
      if (!response.ok) throw new Error("Lorekeeper request failed");
      const turn = normalizeTurn({ ...await response.json(), question });
      if (!turn) throw new Error("Lorekeeper returned an invalid reply");
      intro.remove();
      history.push(turn);
      if (history.length > savedTurnLimit) {
        history.shift();
        transcript.firstElementChild?.remove();
      }
      writeSession(historyKey, history);
      drawTurn(turn);
      scrollToLatest();
      if (questionInput.value === draft) questionInput.value = "";
      status.textContent = "";
    } catch {
      status.textContent = controller.signal.aborted ? "查询超时，请重试。" : "暂时无法查询，请重试。";
    } finally {
      window.clearTimeout(timeout);
      pending = false;
      syncControls();
    }
  });
})();

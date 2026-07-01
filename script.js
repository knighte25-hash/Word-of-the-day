// Word of the Day — app logic
(function () {
  "use strict";

  const STORAGE_HISTORY = "wotd_history";
  const STORAGE_CACHE = "wotd_defcache";
  const EPOCH = new Date(2026, 0, 1); // Jan 1 2026, local time — day 0 of the rotation

  // ---------- date / word selection ----------

  function todayLocal() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function wordForDate(d) {
    const dayIndex = Math.floor((d - EPOCH) / 86400000);
    const len = WORD_LIST.length;
    const idx = ((dayIndex % len) + len) % len;
    return WORD_LIST[idx];
  }

  function formatDateLong(d) {
    return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }

  // ---------- storage helpers ----------

  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_HISTORY)) || [];
    } catch {
      return [];
    }
  }

  function saveHistory(list) {
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(list));
  }

  function upsertHistory(entry) {
    const list = getHistory();
    const i = list.findIndex((e) => e.date === entry.date);
    if (i >= 0) list[i] = entry;
    else list.unshift(entry);
    saveHistory(list);
  }

  function getCache() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_CACHE)) || {};
    } catch {
      return {};
    }
  }

  function cacheWord(word, data) {
    const c = getCache();
    c[word] = data;
    localStorage.setItem(STORAGE_CACHE, JSON.stringify(c));
  }

  // ---------- dictionary API ----------

  async function fetchWordData(word) {
    const cache = getCache();
    if (cache[word]) return cache[word];

    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!res.ok) throw new Error("not found");
    const json = await res.json();
    const entry = json[0];

    let phonetic = entry.phonetic || "";
    let audio = "";
    for (const p of entry.phonetics || []) {
      if (!phonetic && p.text) phonetic = p.text;
      if (!audio && p.audio) audio = p.audio;
    }

    let partOfSpeech = "";
    let definition = "";
    let example = "";
    let synonyms = [];

    for (const m of entry.meanings || []) {
      if (m.synonyms) synonyms = synonyms.concat(m.synonyms);
      for (const d of m.definitions || []) {
        if (!definition) {
          definition = d.definition;
          partOfSpeech = m.partOfSpeech;
        }
        if (!example && d.example) example = d.example;
        if (d.synonyms) synonyms = synonyms.concat(d.synonyms);
      }
    }

    synonyms = [...new Set(synonyms)].slice(0, 6);

    const data = { word, phonetic, audio, partOfSpeech, definition, example, synonyms };
    cacheWord(word, data);
    return data;
  }

  function usageTip(data) {
    if (data.synonyms.length) {
      return `This ${data.partOfSpeech || "word"} works well when you want something more precise or vivid than ${data.synonyms.slice(0, 2).join(" or ")}. Try slipping it into a sentence today.`;
    }
    return `Try using "${data.word}" naturally in conversation today — say a sentence out loud that fits its meaning.`;
  }

  // ---------- render: today's word ----------

  const els = {};

  function cacheEls() {
    [
      "date-label", "word-text", "audio-btn", "phonetic", "part-of-speech",
      "definition", "example-wrap", "example", "usage-wrap", "usage-tip",
      "synonyms-wrap", "synonyms", "error-msg", "word-card",
      "notify-btn", "notify-status",
      "quiz-empty", "quiz-card", "quiz-prompt", "quiz-options", "quiz-feedback", "quiz-next",
      "history-count", "history-list", "clear-history",
    ].forEach((id) => (els[id] = document.getElementById(id)));
  }

  async function loadToday() {
    const today = todayLocal();
    const word = wordForDate(today);
    els["date-label"].textContent = formatDateLong(today);
    els["word-card"].classList.add("loading");
    els["error-msg"].hidden = true;

    try {
      const data = await fetchWordData(word);
      renderWord(data);
      upsertHistory({
        date: dateKey(today),
        word: data.word,
        definition: data.definition,
        partOfSpeech: data.partOfSpeech,
      });
    } catch (err) {
      els["word-text"].textContent = word;
      els["error-msg"].hidden = false;
      els["error-msg"].textContent = "Couldn't load a definition (check your internet connection). The word for today is above — try reloading.";
    } finally {
      els["word-card"].classList.remove("loading");
    }
  }

  function renderWord(data) {
    els["word-text"].textContent = data.word;
    els["phonetic"].textContent = data.phonetic || "";
    els["part-of-speech"].textContent = data.partOfSpeech || "";
    els["definition"].textContent = data.definition || "No definition found.";

    if (data.example) {
      els["example-wrap"].hidden = false;
      els["example"].textContent = data.example;
    } else {
      els["example-wrap"].hidden = true;
    }

    els["usage-wrap"].hidden = false;
    els["usage-tip"].textContent = usageTip(data);

    if (data.synonyms.length) {
      els["synonyms-wrap"].hidden = false;
      els["synonyms"].textContent = data.synonyms.join(", ");
    } else {
      els["synonyms-wrap"].hidden = true;
    }

    if (data.audio) {
      els["audio-btn"].hidden = false;
      const src = data.audio.startsWith("//") ? "https:" + data.audio : data.audio;
      els["audio-btn"].onclick = () => new Audio(src).play().catch(() => {});
    } else {
      els["audio-btn"].hidden = true;
    }
  }

  // ---------- notifications (OneSignal Web Push) ----------
  // Real push, delivered by OneSignal's servers, works even when the app is
  // closed (incl. iOS 16.4+ Home Screen apps). See index.html for SDK setup —
  // you need your own OneSignal App ID plugged in, and the site must be
  // served over HTTPS. The actual daily send is scheduled from the OneSignal
  // dashboard (see setup instructions), not from this file.

  let oneSignal = null;
  let notifyWired = false;

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(function (OneSignal) {
    oneSignal = OneSignal;
    wireNotify();
  });

  function wireNotify() {
    if (notifyWired || !oneSignal || !els["notify-btn"]) return;
    notifyWired = true;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

    function refreshStatus() {
      if (!oneSignal.Notifications.isPushSupported()) {
        els["notify-btn"].disabled = true;
        els["notify-status"].textContent = isIos && !isStandalone
          ? "On iPhone: tap Share → Add to Home Screen, then open the app from your Home Screen to enable notifications."
          : "Push notifications aren't supported in this browser.";
        return;
      }
      if (oneSignal.Notifications.permission) {
        els["notify-btn"].textContent = "🔔 Reminders on";
        els["notify-btn"].disabled = true;
        els["notify-status"].textContent = "You're subscribed. The daily reminder is scheduled from the OneSignal dashboard.";
      } else {
        els["notify-btn"].textContent = "🔔 Remind me daily";
        els["notify-status"].textContent = isIos && !isStandalone
          ? "On iPhone: tap Share → Add to Home Screen first, then reopen from your Home Screen to turn this on."
          : "Turn this on to get a real push notification, even when the app is closed.";
      }
    }

    els["notify-btn"].addEventListener("click", () => {
      oneSignal.Notifications.requestPermission();
    });
    oneSignal.Notifications.addEventListener("permissionChange", refreshStatus);
    refreshStatus();
  }

  // ---------- quiz ----------

  let quizState = null;

  function startQuiz() {
    const history = getHistory().filter((e) => e.definition);
    if (history.length < 4) {
      els["quiz-empty"].hidden = false;
      els["quiz-card"].hidden = true;
      return;
    }
    els["quiz-empty"].hidden = true;
    els["quiz-card"].hidden = false;
    nextQuestion(history);
  }

  function nextQuestion(history) {
    history = history || getHistory().filter((e) => e.definition);
    const target = history[Math.floor(Math.random() * history.length)];
    const pool = history.filter((e) => e.word !== target.word);
    shuffleArray(pool);
    const distractors = pool.slice(0, 3).map((e) => e.definition);
    const options = shuffleArray([target.definition, ...distractors]);

    quizState = { target, options, answered: false };

    els["quiz-prompt"].textContent = `Which definition matches "${target.word}"?`;
    els["quiz-feedback"].textContent = "";
    els["quiz-next"].hidden = true;
    els["quiz-options"].innerHTML = "";

    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "quiz-option";
      btn.textContent = opt;
      btn.onclick = () => answerQuiz(btn, opt);
      els["quiz-options"].appendChild(btn);
    });
  }

  function answerQuiz(btn, chosen) {
    if (quizState.answered) return;
    quizState.answered = true;
    const correct = chosen === quizState.target.definition;

    [...els["quiz-options"].children].forEach((b) => {
      b.disabled = true;
      if (b.textContent === quizState.target.definition) b.classList.add("correct");
      else if (b === btn) b.classList.add("incorrect");
    });

    els["quiz-feedback"].textContent = correct ? "Correct! 🎉" : `Not quite — the right definition is highlighted.`;
    els["quiz-next"].hidden = false;
  }

  function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- history ----------

  function renderHistory() {
    const history = getHistory();
    els["history-count"].textContent = `${history.length} word${history.length === 1 ? "" : "s"} learned`;
    els["history-list"].innerHTML = "";
    if (!history.length) {
      const li = document.createElement("li");
      li.textContent = "No words yet — check back tomorrow!";
      els["history-list"].appendChild(li);
      return;
    }
    for (const entry of history) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="h-date">${entry.date}</span><span class="h-word">${entry.word}</span><p class="h-def">${entry.definition || ""}</p>`;
      els["history-list"].appendChild(li);
    }
  }

  function clearHistory() {
    if (!confirm("Clear all word history? This can't be undone.")) return;
    saveHistory([]);
    renderHistory();
  }

  // ---------- tabs ----------

  function setupTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
        if (btn.dataset.tab === "quiz") startQuiz();
        if (btn.dataset.tab === "history") renderHistory();
      });
    });
  }

  // ---------- init ----------

  function init() {
    cacheEls();
    setupTabs();
    wireNotify();
    els["quiz-next"].addEventListener("click", () => nextQuestion());
    els["clear-history"].addEventListener("click", clearHistory);
    loadToday();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();

// Run only against tools/mobile_chat_fixture.py, using agent-browser eval --stdin.
(async () => {
  if (health.model !== "mobile-fixture-no-gpu") throw new Error("Use the UI fixture, never the live server");
  const checks = [];
  const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
  const nativeFetch = window.fetch;
  const requests = [];
  window.fetch = (url, options) => {
    if (String(url).includes("v1/images/generations")) requests.push(JSON.parse(options.body));
    return nativeFetch(url, options);
  };
  const submit = () => $("img-form").onsubmit(new Event("submit", {cancelable: true}));
  try {
    $("chat-layout").value = "mobile";
    $("chat-layout").dispatchEvent(new Event("change"));
    showTab("images");
    recentImageSeeds = [];
    renderRecentImageSeeds();
    check($("img-recent-seeds").disabled, "Empty seed history disabled");
    $("img-seed-mode").value = "random";
    updateImageSeedMode();
    $("img-prompt").value = "fixture image";
    await submit();
    check(!Object.hasOwn(requests.at(-1), "seed"), "Random omits seed from request");
    check(recentImageSeeds.length === 1 && recentImageSeeds[0].seed >= 1000, "History records actual random result seed");
    const randomSeed = recentImageSeeds[0].seed;
    $("img-recent-seeds").value = "0";
    $("img-recent-seeds").dispatchEvent(new Event("change"));
    check($("img-seed-mode").value === "fixed" && Number($("img-seed").value) === randomSeed, "History selection fills Fixed seed");
    await submit();
    check(requests.at(-1).seed === randomSeed, "Reused seed sent exactly");
    check(recentImageSeeds.length === 2 && recentImageSeeds[1].seed === randomSeed, "Repeated uses retained in log");
    $("img-seed").value = "0";
    updateImageSeedMode();
    await submit();
    check(requests.at(-1).seed === 0 && recentImageSeeds[0].seed === 0, "Seed zero accepted and recorded");
    $("img-seed").value = "9007199254740992";
    const beforeInvalid = requests.length;
    await submit();
    check(requests.length === beforeInvalid, "Unsafe integer seed rejected");
    for (let seed = 1; seed <= 12; seed++) { $("img-seed").value = String(seed); await submit(); }
    check(recentImageSeeds.length === 10 && recentImageSeeds[0].seed === 12 && recentImageSeeds.at(-1).seed === 3,
      "History retains newest ten successful seeds in order");
    check(store.get("imageSeeds").length === 10 && $("img-recent-seeds").options.length === 11, "Ten seeds persisted and available for reuse");
    const beforeError = JSON.stringify(recentImageSeeds);
    $("img-prompt").value = "error";
    await submit();
    check(JSON.stringify(recentImageSeeds) === beforeError && !$("img-go").disabled, "Failed generation leaves history intact and allows retry");
    $("img-prompt").value = "fixture image";
    const beforeDouble = requests.length;
    await Promise.all([submit(), submit()]);
    check(requests.length === beforeDouble + 1, "Duplicate submit while busy is ignored");
    const viewport = window.visualViewport;
    $("img-seed").focus({preventScroll: true});
    Object.defineProperty(viewport, "height", {configurable: true, value: 300});
    Object.defineProperty(viewport, "offsetTop", {configurable: true, value: 12});
    viewport.dispatchEvent(new Event("resize"));
    await settle();
    const button = $("img-go").getBoundingClientRect();
    const footer = document.querySelector(".img-actions").getBoundingClientRect();
    check(button.bottom <= 313 && button.height >= 44, "Generate stays above simulated keyboard");
    check(document.elementFromPoint(button.left + button.width / 2, button.top + button.height / 2)?.closest("#img-go"), "Generate remains clickable with keyboard open");
    const content = document.querySelector(".view--images > .about");
    check(getComputedStyle(content).overflowY === "auto" && content.scrollHeight > content.clientHeight, "Image controls have a scrollable viewport");
    await settle();
    const seedRect = $("img-seed").getBoundingClientRect();
    check(seedRect.top >= content.getBoundingClientRect().top - 1 && seedRect.bottom <= footer.top + 1, "Focused seed automatically scrolls above action footer");
    const sizeRect = $("img-size").getBoundingClientRect();
    const modeRect = $("img-seed-mode").getBoundingClientRect();
    check(modeRect.left > sizeRect.right && Math.abs(sizeRect.top - modeRect.top) < 5, "Seed is beside Size");
    delete viewport.height; delete viewport.offsetTop;
    fitChatViewport();
    $("img-seed-mode").value = "random";
    updateImageSeedMode();
    check($("img-seed").disabled && $("img-fixed-seed").hidden, "Random disables and hides fixed seed field");
    check($("img-results").querySelectorAll("figure").length >= 15, "Successful images remain inline in Images results");
    return {viewport: [innerWidth, innerHeight], checks: checks.length, passed: checks};
  } finally {
    window.fetch = nativeFetch;
    delete window.visualViewport.height; delete window.visualViewport.offsetTop;
    fitChatViewport();
  }
})()

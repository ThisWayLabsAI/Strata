// Fixture-only browser checks. Never run against a real chat or GPU server.
(async () => {
  if (health.model !== "mobile-fixture-no-gpu") throw new Error("Use the isolated fixture");
  const passed = [], check = (ok, name) => { if (!ok) throw new Error(name); passed.push(name); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await pause(20); } throw new Error("Timed out"); };
  await until(() => StrataReferences.ready()); showTab("images");
  const png = StrataImage.fromBase64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==");
  const upload = async files => {
    const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(file));
    $("img-reference-files").files = transfer.files; $("img-reference-files").dispatchEvent(new Event("change"));
    await until(() => !$("img-operation").disabled);
  };
  $("img-operation").value = "edit"; $("img-operation").dispatchEvent(new Event("change"));
  check($("img-go").disabled, "Edit requires a source");
  await upload([new File([png], "source.png", {type:"image/png"}), new File([png], "style.png", {type:"image/png"})]);
  check(StrataReferences.request().length === 2 && !$("img-go").disabled, "Multiple uploads preview before editing");
  const list = $("img-reference-list");
  check(list.querySelectorAll("img").length === 2 && list.querySelector("select").disabled, "Source preview and role are explicit");
  const second = list.children[1].querySelector("select"); second.value = "style"; second.dispatchEvent(new Event("change"));
  check(StrataReferences.request()[1].role === "style", "Additional reference role is retained");
  list.children[1].querySelector("button").click();
  check(StrataReferences.request()[0].name === "style.png" && StrataReferences.request()[0].role === "source", "Reordering updates source and numbered order");
  await upload([new File([png], "third.png", {type:"image/png"}), new File([png], "fourth.png", {type:"image/png"})]);
  check(StrataReferences.request().length === 3, "Reference count is bounded");
  list.lastElementChild.querySelectorAll("button")[2].click();
  check(StrataReferences.request().length === 2, "Remove reference works");
  $("img-prompt").value = "make the sky blue";
  $("img-seed-mode").value = "fixed"; $("img-seed").value = "0"; updateImageSeedMode();
  const nativeFetch = window.fetch, requests = [];
  window.fetch = (url, options) => { if (String(url).includes("v1/images/")) requests.push({url, body:options?.body}); return nativeFetch(url, options); };
  try {
    await $("img-form").onsubmit(new Event("submit", {cancelable:true}));
    const request = requests.find(r => r.url === "v1/images/edits");
    check(!!request && JSON.parse(request.body).references[1].role === "identity", "Edit uses shared API contract with ordered roles");
    const result = $("img-results").firstElementChild;
    const metadata = StrataImage.read(StrataImage.fromBase64(result.querySelector("a").href.split(",")[1]));
    check(metadata.seed === 0 && metadata.operation === "edit" && metadata.references.length === 2 && metadata.references.every(r => /^[a-f0-9]{64}$/.test(r.sha256)), "PNG recipe includes actual seed, operation, hashes and roles");
    check(!JSON.stringify(metadata).includes("data:image"), "Recipes omit reference bytes");
    $("img-template-name").value = "Reference edit fixture"; $("img-save-template").click();
    const saved = imageTemplates.find(item => item.name === "Reference edit fixture");
    check(saved.operation === "edit" && !saved.references, "Saved edit template records mode without source bytes");
    $("img-operation").value = "generate"; $("img-operation").dispatchEvent(new Event("change"));
    $("img-template").value = saved.id; $("img-template").dispatchEvent(new Event("change")); $("img-apply-template").click();
    check($("img-operation").value === "edit", "Saved template restores Edit mode");
    $("img-delete-template").click();
    result.querySelectorAll("button")[1].click();
    check(StrataReferences.request().length === 0 && $("img-go").disabled && $("img-recipe-info").textContent.includes("originals"), "Loading edit recipe requires originals again");
    result.querySelector("button").click(); await until(() => StrataReferences.request().length === 1 && !$("img-operation").disabled);
    check($("img-operation").value === "edit", "Generated output can become a new source");
    // URL importer only uses browser fetch with no API key or credentials.
    let urlOptions;
    window.fetch = (url, options) => { if (String(url).startsWith("https://fixture.example/")) { urlOptions = options; return Promise.resolve(new Response(png, {headers:{"Content-Type":"image/png"}})); } return nativeFetch(url, options); };
    $("img-reference-url").value = "https://fixture.example/reference.png"; $("img-reference-add-url").click();
    await until(() => !$("img-operation").disabled);
    check(StrataReferences.request().length === 2 && urlOptions.credentials === "omit" && urlOptions.redirect === "error" && !urlOptions.headers, "URL import previews bounded bytes without API credentials");
    $("img-reference-url").value = "file:///C:/secret.png"; $("img-reference-add-url").click(); await until(() => !$("img-operation").disabled);
    check(StrataReferences.request().length === 2, "File URLs are rejected");
    window.fetch = (url, options) => String(url).includes("v1/images/edits") ? new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))) : nativeFetch(url, options);
    const pending = $("img-form").onsubmit(new Event("submit", {cancelable:true}));
    check($("img-go").disabled && !$("img-stop").hidden && list.querySelectorAll("button:not(:disabled)").length === 0, "Running job prevents duplicate submission and reference mutation");
    $("img-stop").click(); await pending;
    check(!$("img-go").disabled && $("img-stop").hidden, "Cancellation restores controls");
    check(document.documentElement.scrollWidth <= innerWidth + 1, "Expanded references fit viewport");
    const go = $("img-go").getBoundingClientRect(); check(go.bottom <= innerHeight + 1 && go.top >= 0, "Primary action remains in visible viewport");
  } finally { window.fetch = nativeFetch; }
  return {passed:passed.length, checks:passed};
})();

// Fixture-only: exercise mode/reference-aware templates without a GPU or real chat.
(async () => {
  if (health.model !== "mobile-fixture-no-gpu") throw new Error("Use the isolated fixture");
  const checks = [], check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  const until = async predicate => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
    throw new Error("Timed out");
  };
  await until(() => StrataReferences.ready()); showTab("images");
  const choose = id => { $("img-template").value = id; $("img-template").dispatchEvent(new Event("change")); };
  const mode = value => { $("img-operation").value = value; $("img-operation").dispatchEvent(new Event("change")); };
  const apply = () => $("img-apply-template").click();
  const png = StrataImage.fromBase64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==");
  const transfer = new DataTransfer();
  for (const name of ["source.png", "style.png", "composition.png"]) transfer.items.add(new File([png], name, {type:"image/png"}));
  $("img-reference-files").files = transfer.files; $("img-reference-files").dispatchEvent(new Event("change"));
  await until(() => StrataReferences.request().length === 3 && !$("img-operation").disabled);
  mode("edit");
  const roles = $("img-reference-list").querySelectorAll("select");
  for (const [index, role] of [[1,"style"],[2,"composition"]]) { roles[index].value = role; roles[index].dispatchEvent(new Event("change")); }
  const original = JSON.stringify(StrataReferences.request());
  $("img-subject").value = "Make the coat blue, keeping the face unchanged"; choose("pixar"); apply();
  check($("img-operation").value === "edit" && JSON.stringify(StrataReferences.request()) === original, "Starter preserves Edit mode and all reference bytes, names, roles and order");
  let prompt = $("img-prompt").value;
  check(prompt.startsWith("Edit image 1") && prompt.includes("Requested changes: Make the coat blue") && prompt.includes("Preserve the main subject's identity"), "Edit includes requested changes and identity preservation");
  check(prompt.includes("Image 2 — style") && prompt.includes("Image 3 — composition") && !prompt.includes("style.png"), "Numbered guidance uses roles without filenames");
  check(prompt.includes("Pixar-style") && prompt.includes("No text, letters"), "Starter treatment and text-free instructions retained");
  apply(); check($("img-prompt").value === prompt, "Reapplying does not accumulate context");
  $("img-template-name").value = "Context-aware fixture"; $("img-save-template").click();
  const saved = imageTemplates.find(item => item.name === "Context-aware fixture");
  check(saved.operation === "edit" && saved.prompt.includes("Requested changes: Make the coat blue") && !saved.prompt.includes("Image 2 — style"), "Saved template retains requested changes without freezing generated reference instructions");
  mode("generate");
  check($("img-prompt").value === prompt && $("img-recipe-info").textContent.includes("Reapply"), "Changing mode preserves prompt edits and flags stale instructions");
  choose(saved.id); apply();
  check($("img-operation").value === "generate" && JSON.stringify(StrataReferences.request()) === original, "Saved Edit template preserves selected Generate mode and references");
  check($("img-prompt").value.startsWith("Generate a new image") && !$("img-prompt").value.includes("Edit image 1"), "Saved template regenerates context for current mode");
  const list = $("img-reference-list"); list.children[2].querySelector("button").click();
  check($("img-recipe-info").textContent.includes("Reapply"), "Reordering references flags stale instructions");
  apply();
  check($("img-prompt").value.includes("Image 2 — composition") && $("img-prompt").value.includes("Image 3 — style"), "Reapplying follows current reference order");
  const second = $("img-reference-list").children[1].querySelector("select"); second.value = "identity"; second.dispatchEvent(new Event("change"));
  check($("img-recipe-info").textContent.includes("Reapply"), "Changing reference roles flags stale instructions");
  apply(); check($("img-prompt").value.includes("Image 2 — identity"), "Reapplying updates role guidance");
  mode("edit"); choose("character-sheet"); $("img-subject").value = ""; apply();
  check($("img-prompt").value.includes("Four evenly spaced full-body views") && $("img-prompt").value.includes("composition guidance or sheet layout require otherwise"), "Edit sheet permits new layout while preserving design");
  const nativeFetch = window.fetch, requests = [];
  window.fetch = (url, options) => { if (String(url).includes("v1/images/")) requests.push({url,body:options?.body}); return nativeFetch(url, options); };
  try {
    const submitted = $("img-prompt").value;
    await $("img-form").onsubmit(new Event("submit", {cancelable:true}));
    const sent = requests.find(request => request.url === "v1/images/edits");
    check(!!sent && JSON.parse(sent.body).prompt === submitted && JSON.parse(sent.body).references.length === 3, "Submission sends visible mode-aware prompt and all references to Edit");
    const figure = $("img-results").firstElementChild, bytes = StrataImage.fromBase64(figure.querySelector("a").href.split(",")[1]);
    const recipe = StrataImage.read(bytes);
    check(recipe.prompt === submitted && recipe.templatePrompt && !recipe.templatePrompt.includes("Image 2 — identity"), "PNG keeps actual submitted prompt and reusable base treatment");
    mode("generate"); const before = JSON.stringify(StrataReferences.request());
    [...figure.querySelectorAll("button")].find(button => button.textContent === "Use as template").click();
    check($("img-operation").value === "generate" && JSON.stringify(StrataReferences.request()) === before, "Result template preserves current mode and references");
    check($("img-prompt").value.startsWith("Generate a new image") && !$("img-prompt").value.includes("Edit image 1"), "Result template adapts base treatment without old Edit context");
    await importImageRecipe(new File([bytes], "edit-recipe.png", {type:"image/png"}));
    check($("img-operation").value === "edit" && !StrataReferences.request().length && $("img-go").disabled, "Explicit recipe import still restores mode and requires original references");
  } finally { window.fetch = nativeFetch; }
  choose(saved.id); $("img-delete-template").click();
  mode("generate"); $("img-prompt").value = "keep this draft"; $("img-subject").value = ""; choose("marvel"); apply();
  check($("img-prompt").value === "keep this draft", "Generate without subject or references keeps draft and requests input");
  mode("edit"); apply();
  check($("img-prompt").value.startsWith("Edit image 1") && $("img-go").disabled, "Edit starter can be prepared without a source but cannot run");
  const beforeLong = $("img-prompt").value, beforeSize = $("img-size").value;
  applyImageTemplate({prompt:"x".repeat(16000),name:"Too long",size:"512x512",seed:42});
  check($("img-prompt").value === beforeLong && $("img-size").value === beforeSize && $("img-operation").value === "edit", "Oversized context expansion is rejected before changing the draft or settings");
  $("img-template").closest("details").open = true;
  check(document.documentElement.scrollWidth <= innerWidth + 1, "Context-aware controls fit the viewport");
  return {passed:checks.length,checks};
})();

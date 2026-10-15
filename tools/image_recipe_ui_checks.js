// Fixture-only: Get-Content -Raw tools/image_recipe_ui_checks.js | agent-browser --session <name> eval --stdin
(async () => {
  if (health.model !== "mobile-fixture-no-gpu") throw new Error("Use the fixture, never a live chat");
  const passed = [], check = (value, label) => { if (!value) throw new Error(label); passed.push(label); };
  const nativeFetch = window.fetch, requests = [], oldVision = health.images;
  window.fetch = (url, options) => {
    if (String(url).includes("v1/")) requests.push({url, body: options?.body});
    return nativeFetch(url, options);
  };
  const choose = (id) => { $("img-template").value = id; $("img-template").dispatchEvent(new Event("change")); };
  const submit = () => $("img-form").onsubmit(new Event("submit", {cancelable: true}));
  try {
    showTab("images");
    check($("img-template").querySelectorAll("optgroup").length >= 2, "Genre and sheet starters available");
    choose("marvel"); $("img-subject").value = ""; $("img-prompt").value = "keep my draft"; $("img-apply-template").click();
    check($("img-prompt").value === "keep my draft", "Starter needs a subject before replacing draft");
    $("img-subject").value = "a café cat 🐈 with $& on its badge"; $("img-apply-template").click();
    check($("img-prompt").value.includes("a café cat 🐈 with $& on its badge"), "Starter substitutes Unicode subject literally");
    choose("character-sheet"); $("img-apply-template").click();
    check($("img-prompt").value.includes("No text, letters") && $("img-size").value === "1536x1024", "Text-free sheet prompt and landscape size applied");
    const panel = $("img-template").closest("details"); panel.open = true;
    check(document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector(".view--images > .about").scrollWidth <= innerWidth,
      "Expanded template library fits the viewport");
    panel.open = false;
    $("img-prompt").value = "A café cat 🐈 under soft studio light";
    $("img-seed-mode").value = "fixed"; $("img-seed").value = "0"; updateImageSeedMode(); $("img-steps").value = "6";
    $("img-template-name").value = "Fixture recipe"; $("img-save-template").click();
    const saved = imageTemplates.find((item) => item.name === "Fixture recipe");
    check(saved?.seed === 0 && saved?.steps === 6 && store.get("imageTemplates").some((item) => item.id === saved.id), "Custom template saves prompt, zero seed and steps");
    const templateCount = imageTemplates.length;
    $("img-save-template").click();
    check(imageTemplates.length === templateCount, "Saving the same template name updates it");
    $("img-prompt").value = "discard"; $("img-seed").value = "99"; $("img-steps").value = "10";
    choose(saved.id); $("img-apply-template").click();
    check($("img-prompt").value === saved.prompt && $("img-seed").value === "0" && $("img-steps").value === "6", "Saved template restores settings");
    await submit();
    const figure = $("img-results").firstElementChild, image = figure.querySelector("img");
    figure.dataset.fixtureGenerated = "true";
    await image.decode();
    const bytes = StrataImage.fromBase64(image.src.split(",")[1]), metadata = StrataImage.read(bytes);
    check(metadata.prompt === saved.prompt && metadata.seed === 0 && metadata.model === "fixture-image-model" && metadata.settings.steps === 6,
      "Generated PNG contains actual prompt, model, zero seed and response steps");
    check(!Number.isNaN(Date.parse(metadata.createdAt)), "Generated PNG records generation date");
    const download = figure.querySelector("a[download]");
    check(download.href === image.src && download.download.endsWith(".png") && download.textContent.includes("recipe"), "Download uses the metadata-bearing PNG");
    const beforeReuse = requests.length;
    $("img-prompt").value = "changed"; $("img-seed").value = "123"; $("img-steps").value = "11";
    [...figure.querySelectorAll("button")].find((button) => button.textContent === "Use as template").click();
    check($("img-prompt").value === metadata.prompt && $("img-seed").value === "0" && $("img-steps").value === "6", "Result Use as template restores recipe");
    check(requests.length === beforeReuse, "Using a recipe does not generate an image");
    const file = new File([bytes], "recipe.png", {type: "image/png"});
    $("img-prompt").value = "changed again";
    await importImageRecipe(file);
    check($("img-prompt").value === metadata.prompt && $("img-seed-mode").value === "fixed" && $("img-recipe-info").textContent.includes(metadata.model),
      "Downloaded PNG imports prompt/seed and original model provenance");
    attachments = []; health.images = true;
    [...figure.querySelectorAll("button")].find((button) => button.textContent === "Discuss in chat").click();
    check(tab === "chat" && attachments.some((item) => item.kind === "image") && attachments.some((item) => item.kind === "file" && item.text.includes('"seed": 0')),
      "Discuss in chat prepares image and recipe as user attachments");
    check(requests.length === beforeReuse && !busy, "Discuss in chat does not send or load a model");
    attachments = []; await addChatImage(file);
    check(attachments.length === 2 && userText({text: "revise this", files: attachments.filter((item) => item.kind === "file")}).includes(metadata.prompt),
      "Chat PNG attachment extracts recipe into user message text");
    check(userText({text: "revise", files: attachments.filter((item) => item.kind === "file")}).includes("untrusted file data"), "Chat labels imported recipe values as data, not instructions");
    attachments = []; addFiles([file]);
    check(attachmentReads > 0 && $("send-btn").disabled, "Send waits until PNG and recipe are read");
    for (let i = 0; i < 100 && attachmentReads; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    check(!attachmentReads && !$("send-btn").disabled && attachments.length === 2, "Send becomes available with complete image and recipe");
    attachments = []; health.images = false; await addChatImage(file);
    check(attachments.length === 1 && attachments[0].kind === "file", "Text-only chat can still use PNG generation recipe");
    let rejected = false;
    try { await importImageRecipe(new File([bytes.subarray(0, 30)], "bad.png", {type: "image/png"})); } catch (_) { rejected = true; }
    check(rejected, "Malformed PNG import is rejected");
    const hostilePrompt = '<img src=x onerror="window.recipeExecuted=true">';
    const hostile = StrataImage.write(bytes, {...metadata, prompt: hostilePrompt});
    await importImageRecipe(new File([hostile], "untrusted.png", {type: "image/png"}));
    check(!window.recipeExecuted && $("img-prompt").value === hostilePrompt && !$("img-results").querySelector("img[onerror]"), "Imported metadata renders as data, never HTML");
    $("img-template-name").value = "Temporary deletion check"; $("img-save-template").click();
    const temporary = imageTemplates.find((item) => item.name === "Temporary deletion check"); choose(temporary.id); $("img-delete-template").click();
    check(!imageTemplates.some((item) => item.id === temporary.id), "Saved templates can be deleted");
    $("img-prompt").value = "x".repeat(16385);
    const beforeLong = requests.length; await submit();
    check(requests.length === beforeLong, "Oversized prompt is rejected before generation");
    useImageRecipe(metadata);
    return {viewport: [innerWidth, innerHeight], checks: passed.length, passed};
  } finally { window.fetch = nativeFetch; health.images = oldVision; }
})()

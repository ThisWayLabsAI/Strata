// Inspect a deliberately generated native test result in an isolated browser.
// Does not submit, retry, clear history, or inspect API-key storage.
(async () => {
  if (location.origin !== "http://127.0.0.1:8080" || health.model !== "qwen3.8-flash-next-iq2_xs") throw new Error("Use the coordinated native rollout check");
  const tool = messages.flatMap(message => message.tools || []).filter(tool => tool.image?.state === "completed").at(-1);
  if (!tool || tool.name !== "edit_image") throw new Error("No native completed edit result");
  const image = tool.image, record = await StrataChatImages.get(image.id);
  if (image.recipe.operation !== "edit" || image.recipe.seed !== 904 || image.recipe.size !== "512x512") throw new Error("Wrong native edit recipe");
  if (!image.persisted || !image.embedded) throw new Error("Native result was not saved with its recipe");
  const recipe = StrataImage.read(new Uint8Array(await record.blob.arrayBuffer()));
  if (recipe.operation !== "edit" || recipe.seed !== 904 || recipe.references[0].role !== "source") throw new Error("Embedded provenance mismatch");
  const card = document.querySelector(`[data-chat-image="${image.id}"]`);
  await card.querySelector("img").decode();
  if (!card.querySelector("img").src.startsWith("blob:") || card.querySelector("[data-chat-image-download]").disabled) throw new Error("Preview/download unavailable");
  if (JSON.stringify(apiMessages()).includes("data:image/") || localStorage.getItem("strata.chat").includes("data:image/")) throw new Error("Source pixels entered text history");
  return {passed: true, job: image.id, operation: recipe.operation, seed: recipe.seed, size: recipe.size,
    references: recipe.references, saved: image.persisted, bytes: record.blob.size,
    selectedInputs: chatReferences.length, composerVisible: $("send-btn").getBoundingClientRect().bottom <= innerHeight + 1};
})();

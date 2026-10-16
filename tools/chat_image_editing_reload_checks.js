// Fixture only, after chat_image_editing_ui_checks.js and a real refresh.
(async () => {
  if (health.model !== "mobile-fixture-no-gpu") throw new Error("Use the isolated fixture");
  const checks = [], check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  const image = messages.flatMap(message => message.tools || []).filter(tool => tool.image?.state === "completed").at(-1).image;
  const record = await StrataChatImages.get(image.id);
  check(record.blob instanceof Blob && record.recipe.operation === "edit", "Edited output and provenance survive refresh in IndexedDB");
  check(chatReferences.length === 0 && $("chat-image-settings").textContent.includes("0 refs"), "Refresh never silently reuses missing input reference bytes");
  $("chat-image-settings").click();
  check($("chat-image-inputs").textContent.includes("reattach"), "Unavailable temporary inputs have visible reattachment guidance");
  for (let i = 0; i < 100 && !$("chat").querySelector(`[data-chat-image="${image.id}"] img[src]`); i++) await new Promise(r => setTimeout(r, 20));
  const card = $("chat").querySelector(`[data-chat-image="${image.id}"]`);
  await card.querySelector("img").decode();
  check(card.querySelector("img").src.startsWith("blob:"), "Refresh restores edited output preview without regenerating");
  card.querySelector("[data-chat-image-reference]").click();
  for (let i = 0; i < 100 && !chatReferences.length; i++) await new Promise(r => setTimeout(r, 20));
  check(chatReferences.length === 1 && $("chat-image-operation").value === "edit", "Stored output can be explicitly reselected after refresh");
  return {passed: checks.length, checks};
})();

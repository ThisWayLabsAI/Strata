// Typed chat image results. Blobs live in IndexedDB, never in the model context or localStorage.
(() => {
  "use strict";
  const cache = new Map(), loading = new Map(), ACTIVE = ["queued", "preparing", "generating", "restoring"];
  const labels = {queued:"Image queued", preparing:"Preparing GPU", generating:"Generating image", restoring:"Releasing GPU / restoring chat",
    completed:"Image ready", cancelled:"Image cancelled", failed:"Image failed", interrupted:"Image request interrupted"};
  let database;
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      let expired = false;
      const request = indexedDB.open("strata.chatImages", 1);
      const timer = setTimeout(() => { expired = true; reject(new Error("Image storage timed out")); }, 5000);
      request.onupgradeneeded = () => request.result.createObjectStore("images", {keyPath:"id"});
      request.onerror = () => { clearTimeout(timer); reject(request.error); };
      request.onblocked = () => { clearTimeout(timer); expired = true; reject(new Error("Image storage is blocked by another tab")); };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (expired) { request.result.close(); return; }
        request.result.onversionchange = () => { request.result.close(); database = null; };
        resolve(request.result);
      };
    }).catch(error => { database = null; throw error; });
    return database;
  }
  async function transaction(mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("images", mode), request = operation(tx.objectStore("images"));
      tx.oncomplete = () => resolve(request?.result);
      tx.onabort = () => reject(tx.error || new Error("Image storage transaction failed"));
      tx.onerror = () => {}; // onabort reports the complete transaction failure
    });
  }
  async function get(id) {
    if (cache.has(id)) return cache.get(id);
    if (!loading.has(id)) loading.set(id, transaction("readonly", store => store.get(id)).then(record => {
      if (!record || !(record.blob instanceof Blob)) throw new Error("The image is unavailable in this browser. It was not regenerated.");
      delete record.url; cache.set(id, record); return record;
    }).finally(() => loading.delete(id)));
    return loading.get(id);
  }
  function url(record) { return record.url ||= URL.createObjectURL(record.blob); }
  function filename(id) { return `strata-image-${id}.png`; }
  function html(tool) {
    const image = tool.image;
    if (!image) return "";
    const complete = image.state === "completed", recipe = image.recipe;
    return `<section class="chat-image st-card" data-chat-image="${esc(image.id)}" aria-label="Generated image">` +
      `<div class="chat-image-state" role="status">${esc(labels[image.state] || "Image result")}${image.step != null ? ` · ${esc(image.step)}/${esc(image.steps)} steps` : ""}</div>` +
      (complete ? `<img class="chat-image-preview" alt="${esc(recipe.prompt)}" hidden>` +
        `<p class="muted small">${esc(recipe.size)} · seed ${esc(recipe.seed)}</p>` +
        `<p class="chat-image-storage muted small">${image.persisted ? "Saved in this browser" : "Not saved in this browser — download to keep it."}</p>` +
        `<div class="img-template-actions"><button type="button" class="st-btn st-btn--secondary" data-chat-image-download disabled>${image.embedded ? "Download PNG + recipe" : "Download PNG"}</button>` +
        `<button type="button" class="st-btn st-btn--secondary" data-chat-image-template>Use as template</button>` +
        `<button type="button" class="st-btn st-btn--secondary" data-chat-image-reference ${health.chat_image_editing ? "" : "hidden"}>Edit this image</button></div>` +
        `<details><summary>Generation recipe</summary><pre class="tool-call__pre">${esc(JSON.stringify(recipe, null, 2))}</pre></details>` : "") +
      (image.error ? `<p class="chat-image-error">${esc(image.error)}</p>` : "") +
      (image.warning ? `<p class="chat-image-error">${esc(image.warning)}</p>` : "") + `</section>`;
  }
  function decorate(element, message) {
    for (const card of element.querySelectorAll("[data-chat-image]")) {
      const image = message.tools?.find(tool => tool.image?.id === card.dataset.chatImage)?.image;
      if (image?.state !== "completed") continue;
      get(image.id).then(record => {
        if (!card.isConnected) return;
        const preview = card.querySelector("img");
        const following = mobileChat && followLatest;
        const [width,height] = image.recipe.size.split("x").map(Number);
        preview.width = width; preview.height = height;
        preview.onerror = () => { preview.hidden = true; card.querySelector(".chat-image-storage").textContent = "Preview unavailable. Download the PNG to inspect it. " + (image.persisted ? "Saved in this browser." : "Not saved — download before leaving."); };
        preview.src = url(record); preview.hidden = false;
        if (following) scrollDown(true);
        card.querySelector("[data-chat-image-download]").disabled = false;
        if (image.storageError) card.querySelector(".chat-image-storage").textContent = image.storageError;
      }).catch(error => { if (card.isConnected) card.querySelector(".chat-image-storage").textContent = error.message; });
    }
  }
  async function onEvent(message, event) {
    if (!event || typeof event.id !== "string" || !/^[a-f0-9]{32}$/.test(event.job_id) || !Number.isSafeInteger(event.sequence) || event.sequence < 1) return;
    message.tools ||= [];
    let tool = message.tools.find(tool => tool.id === event.id);
    if (!tool) { tool = {id:event.id,name:event.name === "edit_image" ? "edit_image" : "generate_image",at:message.text.length,rat:message.reasoning.length,state:"running"}; message.tools.push(tool); }
    if (event.sequence <= (tool.image?.sequence || 0)) return;
    if (event.state === "recovery_failed") {
      if (tool.image?.state === "completed") { tool.image.warning = event.error; tool.image.sequence = event.sequence; saveChat(); }
      return;
    }
    if (tool.image?.state === "completed" || !Object.hasOwn(labels, event.state)) return;
    const image = tool.image = {id:event.job_id,state:event.state,sequence:event.sequence,error:event.error};
    if (event.state === "generating" && Number.isInteger(event.step) && Number.isInteger(event.steps) && event.step >= 0 && event.step <= event.steps && event.steps <= 100) {
      image.step = event.step; image.steps = event.steps;
    }
    if (event.state === "completed") {
      try {
        image.recipe = StrataImage.recipe(event.recipe);
        tool.state = "done"; tool.ok = true; tool.round ??= 1;
        tool.arguments ||= {prompt:image.recipe.prompt, size:image.recipe.size};
        tool.result = JSON.stringify({status:"completed",job_id:image.id,seed:image.recipe.seed,size:image.recipe.size,model:image.recipe.model});
        if (typeof event.b64_json !== "string" || event.b64_json.length > 27_000_000) throw new Error("Invalid or oversized image result");
        let bytes = StrataImage.fromBase64(event.b64_json); image.embedded = false;
        try { bytes = StrataImage.write(bytes, image.recipe); image.embedded = true; }
        catch (error) { image.warning = "Image created, but its recipe could not be embedded: " + error.message; }
        const record = {id:image.id, messageId:message.id, blob:new Blob([bytes], {type:"image/png"}), recipe:image.recipe};
        cache.set(image.id, {...record});
        try { await transaction("readwrite", store => store.put(record)); image.persisted = true; }
        catch (error) { image.persisted = false; image.storageError = "Not saved in this browser. Download the image before leaving: " + error.message; toast("warn", "Image not saved", image.storageError, 8000); }
      } catch (error) { image.state = "failed"; image.error = "Could not read the generated result: " + error.message; }
    }
    if (["failed","cancelled"].includes(image.state)) {
      tool.state = image.state === "cancelled" ? "skipped" : "error"; tool.ok = false;
      tool.result = image.error || "Image request did not complete.";
    }
    if (!ACTIVE.includes(image.state) || image.state === "queued") {
      if (!await saveChat() && image.state === "completed") {
        image.storageError = "Chat history could not be saved. Download the image before leaving.";
        toast("warn", "Chat image history not saved", image.storageError, 8000);
      }
    }
  }
  function finish(message, cancelled) {
    for (const tool of message.tools || []) if (tool.image && ACTIVE.includes(tool.image.state)) {
      tool.image.state = cancelled ? "cancelled" : "interrupted";
      tool.image.error = cancelled ? "Stopped. No image was saved." : "The request ended before an image result arrived. No automatic retry was made.";
      tool.state = "skipped";
    }
  }
  async function action(event, message) {
    const thread = currentThreadId();
    const button = event.target.closest("[data-chat-image-download], [data-chat-image-template], [data-chat-image-reference]");
    if (!button) return false;
    const id = button.closest("[data-chat-image]").dataset.chatImage, image = message.tools.find(tool => tool.image?.id === id)?.image;
    try {
      if (button.hasAttribute("data-chat-image-reference")) {
        const record = await get(id);
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(record.blob); });
        if (thread !== currentThreadId() || threadTransition) throw new Error("Chat changed. Select the image again in the current chat.");
        if (chatReferences.length) throw new Error("Remove current references before choosing a new edit source.");
        selectChatReference(data, filename(id)); $("chat-image-operation").value = "edit"; renderChatReferences(); $("input").focus();
      }
      else if (button.hasAttribute("data-chat-image-template")) applyImageTemplate(image.recipe);
      else {
        const record = await get(id), link = document.createElement("a"); link.href = url(record); link.download = filename(id); link.click();
      }
    } catch (error) { toast("error", "Image unavailable", error.message); }
    return true;
  }
  async function remove(ids) {
    for (const id of ids) {
      if (loading.has(id)) { try { await loading.get(id); } catch (_) { /* missing records can still be deleted */ } }
      const record = cache.get(id); if (record?.url) URL.revokeObjectURL(record.url); cache.delete(id);
      try { await transaction("readwrite", store => store.delete(id)); }
      catch (error) { toast("warn", "Could not delete a saved image", error.message + ". Clear this site's browser storage to remove it."); }
    }
  }
  function exported(message) {
    return (message.tools || []).filter(tool => tool.image?.recipe).map(tool =>
      `\n\n![Generated image](${filename(tool.image.id)})\n\nDownload ${filename(tool.image.id)} separately from the image card.\n\n` +
      "```json\n" + JSON.stringify(tool.image.recipe, null, 2) + "\n```\n").join("");
  }
  function recover(messages) { messages.forEach(message => finish(message, false)); }
  globalThis.StrataChatImages = {html, decorate, onEvent, finish, action, remove, exported, recover, get, filename};
})();

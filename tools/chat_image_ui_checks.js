// Fixture only. Follow with chat_image_reload_checks.js after a real browser reload.
(async () => {
  if (health.model !== "mobile-fixture-no-gpu") throw new Error("Use the isolated fixture");
  const checks=[], check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label);};
  const until=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw new Error("Timed out");};
  const nativeFetch=window.fetch, requests=[];
  window.fetch=(url,options)=>{if(String(url).includes("chat/completions"))requests.push(JSON.parse(options.body));return nativeFetch(url,options);};
  const latest=()=>messages.at(-1).tools?.find(tool=>tool.image)?.image;
  try {
    showTab("chat"); messages=[]; renderChat();
    check(!$("chat-image-row").hidden,"Chat image option is visible when supported");
    $("chat-image-enabled").checked=false;
    $("input").value="image"; await send();
    check(!requests.at(-1).strata_images && !messages.at(-1).tools?.some(tool=>tool.image),"Default text chat never opts into image generation");
    $("chat-image-enabled").checked=true; $("chat-image-enabled").dispatchEvent(new Event("change"));
    $("input").value="image"; await send();
    const image=latest(), message=messages.at(-1);
    check(requests.at(-1).strata_images===true && image.state==="completed","Enabled chat receives a typed inline image");
    await until(()=>!!$("chat").querySelector(`[data-chat-image="${image.id}"] img[src]`));
    const card=$("chat").querySelector(`[data-chat-image="${image.id}"]`);
    check(message.tools.filter(tool=>tool.image).length===1,"Duplicate completion events create one result");
    check(card.querySelector("img").src.startsWith("blob:") && !card.querySelector("[data-chat-image-download]").disabled,"Preview and download use a local object URL");
    const record=await StrataChatImages.get(image.id), recipe=StrataImage.read(new Uint8Array(await record.blob.arrayBuffer()));
    check(image.persisted && recipe.seed===0 && recipe.prompt==="a fixture red robot","Saved PNG contains the actual prompt and zero seed");
    const beforePreviewError=requests.length; card.querySelector("img").dispatchEvent(new Event("error"));
    check(card.querySelector("img").hidden && !card.querySelector("[data-chat-image-download]").disabled && requests.length===beforePreviewError,"Preview failure keeps download available without regenerating");
    check(!JSON.stringify(store.get("chat")).includes("b64_json") && !JSON.stringify(store.get("chat")).includes("blob:"),"Transcript stores metadata without image bytes or ephemeral URLs");
    check(!JSON.stringify(apiMessages()).includes("b64_json") && !JSON.stringify(apiMessages()).includes("blob:"),"Image pixels are absent from the next text model context");
    const exported=StrataChatImages.exported(message);
    check(exported.includes(StrataChatImages.filename(image.id)) && exported.includes('"seed": 0') && !exported.includes("blob:"),"Markdown export includes recipe and portable image filename");
    await StrataChatImages.onEvent(message,{id:message.tools[0].id,job_id:image.id,sequence:99,state:"generating"});
    check(latest().state==="completed","Late progress cannot replace a completed image");
    store.set("fixtureChatImageId",image.id);
    $("input").value="image recovery error"; await send();
    check(latest().state==="completed" && latest().warning.includes("reload failed"),"Chat recovery failure leaves the completed image available");
    $("input").value="image error"; await send();
    check(latest().state==="failed" && latest().error.includes("Fixture"),"Failed generation has an explicit inline state");
    $("input").value="image slow"; const pending=send();
    await until(()=>messages.at(-1).tools?.some(tool=>tool.image)); $("stop-btn").click(); await pending;
    check(latest().state==="cancelled" && !busy,"Stop ends the image card without automatic retry");
    const transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args){if(this.name==="strata.chatImages" && args[1]==="readwrite")throw new DOMException("Fixture quota failure","QuotaExceededError");return transaction.apply(this,args);};
    try { $("input").value="image"; await send(); }
    finally { IDBDatabase.prototype.transaction=transaction; }
    const unsaved=latest();
    check(unsaved.state==="completed" && !unsaved.persisted && unsaved.storageError.includes("Not saved"),"Storage failure preserves result with an explicit unsaved warning");
    const unsavedRecord=await StrataChatImages.get(unsaved.id);
    check(unsavedRecord.blob instanceof Blob,"Unsaved image remains downloadable in memory");
    await StrataChatImages.remove([unsaved.id]); renderChat();
    await until(()=>[...$("chat").querySelectorAll(".chat-image-storage")].some(el=>el.textContent.includes("unavailable")));
    check(!busy,"Missing image storage never triggers generation");
    check(document.documentElement.scrollWidth<=innerWidth+1,"Inline image cards fit the viewport");
    const sendButton=$("send-btn").getBoundingClientRect(); check(sendButton.bottom<=innerHeight+1,"Composer remains visible with chat image option");
    saveChat();
  } finally {window.fetch=nativeFetch;}
  return {passed:checks.length,checks};
})();

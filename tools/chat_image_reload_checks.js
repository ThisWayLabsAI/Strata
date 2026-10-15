// Fixture-only persistence/deletion checks, after chat_image_ui_checks.js and a browser reload.
(async () => {
  if(health.model!=="mobile-fixture-no-gpu")throw new Error("Use the isolated fixture");
  const checks=[],check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label);};
  const id=store.get("fixtureChatImageId"),record=await StrataChatImages.get(id);
  const persisted=await new Promise((resolve,reject)=>{const request=indexedDB.open("strata.chatImages",1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction("images"),read=tx.objectStore("images").get(id);tx.oncomplete=()=>{db.close();resolve(read.result);};tx.onabort=()=>reject(tx.error);};});
  check(persisted.blob instanceof Blob && !persisted.url,"Reload reads persisted blob without an expired object URL");
  check($("chat-image-enabled").checked,"Chat image opt-in survives refresh");
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  for(let i=0;i<100&&!$("chat").querySelector(`[data-chat-image="${id}"] img[src]`);i++)await wait(20);
  const preview=$("chat").querySelector(`[data-chat-image="${id}"] img`); await preview.decode();
  check(preview.src.startsWith("blob:"),"Refresh reconstructs preview from IndexedDB without generation");
  const recipe=StrataImage.read(new Uint8Array(await record.blob.arrayBuffer()));check(recipe.seed===0,"PNG recipe survives a real refresh");
  const backup=messages;
  $("new-btn").click();
  [...$("toasts").querySelectorAll("button")].find(button=>button.textContent==="Undo").click();
  await wait(6700);
  check(messages===backup && (await StrataChatImages.get(id)).blob instanceof Blob,"Undo preserves transcript and saved image");
  $("new-btn").click(); await wait(6700);
  let missing=false;try{await StrataChatImages.get(id);}catch(_){missing=true;}
  check(!messages.length && missing,"Clearing chat deletes image blobs after the Undo window");
  return {passed:checks.length,checks};
})();

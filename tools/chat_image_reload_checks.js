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
  const backup=currentThreadId();
  await changeThread();
  check(!messages.length && (await StrataChatImages.get(id)).blob instanceof Blob,"New chat preserves archived images");
  await changeThread(backup);
  check(messages.some(m=>m.tools?.some(t=>t.image?.id===id)),"Opening saved chat restores image transcript");
  await changeThread();
  const deleted=await StrataThreads.get(backup);
  await StrataChatImages.remove(await StrataThreads.remove(backup,deleted.revision));
  let missing=false;try{await StrataChatImages.get(id);}catch(_){missing=true;}
  check(!messages.length && missing,"Explicit thread deletion removes its orphan image blobs");
  return {passed:checks.length,checks};
})();

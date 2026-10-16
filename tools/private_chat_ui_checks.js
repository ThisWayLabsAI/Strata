// CPU fixture only. Follow with private_chat_reload_checks.js after a real reload.
(async () => {
  if (location.port !== "8091" || health.model !== "mobile-fixture-no-gpu") throw new Error("Use isolated CPU fixture 8091");
  const checks=[],check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label);};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async predicate=>{for(let i=0;i<150;i++){if(predicate())return;await wait(20);}throw new Error("Private fixture timed out");};
  await changeThread();
  $("chat-image-enabled").checked=false; $("chat-image-operation").value="generate";
  $("input").value="Public conversation kept"; await send(); await threadQueue;
  const publicId=currentThreadId(), publicRecord=JSON.stringify(await StrataThreads.get(publicId));
  const publicMirror=localStorage.getItem("strata.chat"), publicModel=localStorage.getItem("strata.chatModel");
  const marker="private-fixture-sensitive";
  $("input").value=marker+" unsent draft";
  const put=IDBObjectStore.prototype.put,add=IDBObjectStore.prototype.add,set=Storage.prototype.setItem;
  let writes=0, leaks=[];
  IDBObjectStore.prototype.put=function(...args){writes++;return put.apply(this,args);};
  IDBObjectStore.prototype.add=function(...args){writes++;return add.apply(this,args);};
  Storage.prototype.setItem=function(key,value){if(String(value).includes(marker))leaks.push(key);return set.call(this,key,value);};
  try {
    await setPrivateChat(true);
    check(isPrivateChat() && $("private-chat").checked,"Toggle enters private mode");
    check(messages[0].text==="Public conversation kept" && $("input").value.includes(marker),"Entering private keeps the current conversation and unsent draft in memory");
    check(JSON.stringify(await StrataThreads.get(publicId))===publicRecord,"Activation leaves the already-saved copy unchanged");
    $("input").dispatchEvent(new Event("input")); await wait(500); await saveChat();
    check(writes===0 && !leaks.length,"Private draft autosave performs no IndexedDB writes or localStorage leaks");
    $("chat-image-enabled").checked=true;
    $("input").value="image "+marker; await send(); await threadQueue;
    const image=messages.at(-1).tools?.find(t=>t.image)?.image;
    check(image?.state==="completed" && image.private && !image.persisted,"Private generated image is explicitly memory-only");
    const id=image.id, record=await StrataChatImages.get(id);
    check(record.blob instanceof Blob,"Private image stays available for preview and explicit download");
    check(writes===0 && !leaks.length,"Private text, tool result, recipe and PNG generate no browser database writes");
    check(localStorage.getItem("strata.chat")===publicMirror && localStorage.getItem("strata.chatModel")===publicModel,"Private sends leave compatibility chat and model copies untouched");
    await until(()=>$("chat").querySelector("[data-chat-image-template]"));
    check($("chat").querySelector("[data-chat-image-template]").disabled,"Private recipe cannot transfer silently into public image templates");
    const selection=$("chat").querySelector("[data-chat-image-reference]");
    selection.click(); await until(()=>chatReferences.length===1);
    $("input").value="image "+marker+" edit"; await send();
    const edited=messages.at(-1).tools?.find(t=>t.image);
    check(edited?.name==="edit_image" && edited.image.private && writes===0,"Editing a private output keeps the source and new result in memory without database writes");
    $("chat-image-operation").value="generate"; chatReferences.splice(0); renderChatReferences();
    await refreshThreads();
    check(!libraryRecords.some(r=>r.id===currentThreadId()),"Private conversation never appears in the saved library");
    let guard=false;try{await StrataThreads.save({...activeThread,messages},0);}catch(_){guard=true;}
    check(guard && writes===0,"Thread storage refuses a direct private-record write");
    const old=currentThreadId(), replacement=changeThread();
    await until(()=>$("private-discard-dialog").open);
    check($("input").disabled && $("private-chat").disabled,"Pending discard confirmation blocks typing and privacy changes");
    $("private-discard-dialog").close("cancel"); await replacement;
    check(currentThreadId()===old && isPrivateChat(),"Cancel preserves private chat and image");
    const next=changeThread(); await until(()=>$("private-discard-dialog").open);
    $("private-discard-dialog").close("discard"); await next;
    check(isPrivateChat() && currentThreadId()!==old && !messages.length,"New private chat discards the old private contents and remains private");
    let missing=false;try{await StrataChatImages.get(id);}catch(_){missing=true;}
    check(missing,"Leaving the private conversation drops cached private PNG bytes");
    check(writes===0,"Private New never creates a database thread");
  } finally {IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.add=add;Storage.prototype.setItem=set;}
  await setPrivateChat(false);
  check(!isPrivateChat() && !!await StrataThreads.get(currentThreadId()),"Turning privacy off starts a separate saved conversation");
  await setPrivateChat(true);
  $("input").value=marker+" after public return"; await send();
  $("input").value=marker+" reload draft"; await saveChat();
  check(!(JSON.stringify(await StrataThreads.list())).includes(marker),"Private titles and content never enter the thread index");
  const toggle=$("private-chat").closest("label").getBoundingClientRect();
  check(toggle.height>=44 && toggle.left>=0 && toggle.right<=innerWidth,"Privacy toggle is touch-sized and fits the viewport");
  const sendBox=$("send-btn").getBoundingClientRect();
  check(sendBox.top>=0 && sendBox.bottom<=innerHeight && document.documentElement.scrollWidth<=innerWidth,"Private guidance leaves the mobile composer reachable");
  return {passed:checks.length,checks};
})();

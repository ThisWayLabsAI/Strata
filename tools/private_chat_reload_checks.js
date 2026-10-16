// CPU fixture only, after private_chat_ui_checks.js and a real browser reload.
(async()=>{
  if(location.port!=="8091")throw Error("Use CPU fixture 8091");
  const checks=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  check(threadsReady && !isPrivateChat() && !$("private-chat").checked,"Reload never restores private mode");
  check(!JSON.stringify(messages).includes("private-fixture-sensitive") && !$("input").value.includes("private-fixture-sensitive"),"Private history and draft disappear after real reload");
  for(const meta of await StrataThreads.list()) {
    const record=await StrataThreads.get(meta.id);
    if(JSON.stringify(record).includes("private-fixture-sensitive"))throw Error("Private data leaked to IndexedDB");
  }
  check(true,"No stored thread contains private messages or draft");
  check(!Object.values(localStorage).some(v=>v.includes("private-fixture-sensitive")),"LocalStorage contains no private conversation content");
  return {passed:checks.length,checks};
})();

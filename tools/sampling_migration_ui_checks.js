// Isolated CPU fixture only, with synthetic drafts and preferences.
(async()=>{
  if(location.port!=="8091"||health.model!=="mobile-fixture-no-gpu")throw Error("Use CPU fixture 8091");
  const checks=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const wait=()=>new Promise(r=>setTimeout(r,150));
  openDrawer(true);$("s-reset").click();$("s-apply").click();await wait();
  check(settings.samplingMode==="model"&&store.get("sampling").samplingMode==="model","Reset saves model-card sampling mode");
  openDrawer(true);$("s-temp").value="0.6";$("s-temp").dispatchEvent(new Event("input"));$("s-apply").click();await wait();
  check(settings.temperature===0.6&&settings.samplingMode==="custom","Editing temperature selects explicit sampling");
  check(store.get("sampling").samplingMode==="custom","Explicit mode is persisted with its values");
  const originalFetch=window.fetch,bodies=[];
  window.fetch=(url,init)=>{if(String(url).includes("/chat/completions"))bodies.push(JSON.parse(init.body));return originalFetch(url,init);};
  try{$("input").value="hello";await send();}finally{window.fetch=originalFetch;}
  check(bodies[0].temperature===0.6&&bodies[0].top_p===0.95&&bodies[0].top_k===20,"An explicit 0.6 reaches the chat request");
  return {passed:checks.length,checks};
})();

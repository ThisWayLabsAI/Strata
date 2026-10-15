// Fixture only. Exercise native button submission, including browser validation.
(async () => {
  if (health.model !== "mobile-fixture-no-gpu") throw new Error("Use the isolated fixture");
  const passed=[], check=(ok,name)=>{if(!ok)throw new Error(name);passed.push(name);};
  const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
  const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await pause();}throw new Error("Timed out");};
  await until(()=>StrataReferences.ready());showTab("images");
  const nativeFetch=window.fetch, requests=[];
  let response;
  window.fetch=(url,options)=>{
    if(options?.method==="POST" && String(url).includes("v1/images/")) {
      requests.push({url,body:JSON.parse(options.body)});
      if(response)return Promise.resolve(response());
    }
    return nativeFetch(url,options);
  };
  const click=async()=>{$("img-go").click();await until(()=>$("img-progress").hidden);};
  try {
    $("img-prompt").value="";await click();
    check(!requests.length && $("img-hint").textContent.includes("Enter a prompt") && document.activeElement===$("img-prompt"),"Empty prompt gives persistent feedback and focus without a request");
    $("img-prompt").value="A red robot";$("img-steps").value="101";await click();
    check(!requests.length && $("img-hint").textContent.includes("Steps must") && document.activeElement===$("img-steps"),"Invalid steps explain the allowed range through actual button submission");
    $("img-steps").value="";$("img-seed-mode").value="fixed";updateImageSeedMode();$("img-seed").value="-1";await click();
    check(!requests.length && $("img-hint").textContent.includes("fixed seed"),"Invalid fixed seed explains recovery");
    $("img-seed-mode").value="random";updateImageSeedMode();
    $("img-reference-url").value="unfinished URL";$("img-reference-panel").open=false;await click();
    check(requests.length===1 && $("img-hint").textContent.startsWith("Done."),"Unused invalid reference URL in closed panel does not block generation");
    $("img-operation").value="edit";$("img-operation").dispatchEvent(new Event("change"));
    check($("img-go").disabled && $("img-hint").textContent.includes("Add a source image"),"Disabled Edit has its missing-source reason beside the button");
    const transfer=new DataTransfer();transfer.items.add(new File([StrataImage.fromBase64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==")],"source.png",{type:"image/png"}));
    $("img-reference-files").files=transfer.files;$("img-reference-files").dispatchEvent(new Event("change"));await until(()=>!$("img-go").disabled);
    await click();check(requests.at(-1).url==="v1/images/edits" && $("img-hint").textContent.startsWith("Done."),"Edit button submits with a source despite unfinished URL");
    for(const [status,payload,expected] of [[401,{},"API key"],[500,{error:{message:"Image runner unavailable"}},"Image runner unavailable"],[200,{data:[]},"no image"]]) {
      response=()=>new Response(JSON.stringify(payload),{status});await click();
      check($("img-hint").textContent.includes(expected) && !$("img-go").disabled && $("img-progress").hidden,`HTTP ${status} feedback persists and permits retry`);
    }
    response=()=>new Response("gateway failed",{status:502});await click();
    check($("img-hint").textContent.includes("HTTP 502"),"Non-JSON server error is explained");
    window.fetch=()=>Promise.reject(new TypeError("Failed to fetch"));await click();
    check($("img-hint").textContent.includes("Failed to fetch") && StrataReferences.request().length===1 && $("img-prompt").value==="A red robot","Network failure preserves prompt and source with retry feedback");
  } finally {window.fetch=nativeFetch;StrataReferences.restore({operation:"generate"});$("img-reference-url").value="";$("img-steps").value="";}
  return {passed:passed.length,checks:passed};
})();

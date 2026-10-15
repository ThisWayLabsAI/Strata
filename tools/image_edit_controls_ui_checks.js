// Isolated fixture only: edits history, references and form settings.
(async () => {
  if (health.model !== "mobile-fixture-no-gpu") throw new Error("Use the isolated fixture");
  const passed=[], check=(ok,name)=>{if(!ok)throw new Error(name);passed.push(name);};
  const until=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw new Error("Timed out");};
  const change=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new Event("change"));};
  const mode=value=>change("img-operation",value), controls=StrataImageEditing;
  await until(()=>StrataReferences.ready()); showTab("images"); $("img-edit-controls").open=true;
  StrataReferences.restore({operation:"generate"}); controls.restore({});
  $("img-region-tool").value="box";$("img-region-tool").dispatchEvent(new Event("change"));
  $("img-prompt").value="Replace the red square with a green sphere.";
  check(controls.prepare("unchanged",[],"generate").prompt==="unchanged","Opt-in controls preserve the default request prompt");
  check($("img-region-controls").disabled,"Generate does not expose an active edit-region selector");
  const original=document.createElement("canvas"); original.width=600;original.height=400;
  const ctx=original.getContext("2d");ctx.fillStyle="#c4dfff";ctx.fillRect(0,0,600,400);ctx.fillStyle="red";ctx.fillRect(60,80,140,160);ctx.fillStyle="gold";ctx.beginPath();ctx.arc(450,200,65,0,Math.PI*2);ctx.fill();
  const bytes=StrataImage.fromBase64(original.toDataURL("image/png").split(",")[1]);
  const upload=async (name,content=bytes)=>{const dt=new DataTransfer();dt.items.add(new File([content],name,{type:"image/png"}));$("img-reference-files").files=dt.files;$("img-reference-files").dispatchEvent(new Event("change"));await until(()=>!$("img-operation").disabled);};
  mode("edit");await upload("source.png");await until(()=>$("img-region-canvas").width===600);
  $("img-region-enabled").checked=true;$("img-region-enabled").dispatchEvent(new Event("change"));
  check(!$("img-region-editor").hidden,"Source offers a visible region marker in Edit");
  let refused=false;try{controls.prepare("replace",StrataReferences.request(),"edit");}catch(_){refused=true;}
  check(refused,"Enabled region without a selection never silently edits the whole image");
  $("img-region-center").click();
  const before=StrataReferences.request()[0].data;
  let prepared=controls.prepare("replace",StrataReferences.request(),"edit");
  check(prepared.references.length===2 && prepared.references[0].data===before && prepared.references[1].role==="composition","Guide uses a separate slot and preserves original source bytes");
  const guide=new Image();guide.src=prepared.references[1].data;await guide.decode();
  const sample=document.createElement("canvas");sample.width=600;sample.height=400;const pixels=sample.getContext("2d");pixels.drawImage(guide,0,0);
  check(pixels.getImageData(150,100,1,1).data[0]>220 && pixels.getImageData(150,100,1,1).data[1]<70,"Guide PNG contains the visible red region outline");
  const canvas=$("img-region-canvas");canvas.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,cancelable:true}));
  check(Math.abs(controls.settings().region[0]-.27)<.001,"Keyboard moves the selected region");
  canvas.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",shiftKey:true,bubbles:true,cancelable:true}));
  check(Math.abs(controls.settings().region[3]-.52)<.001,"Shift and arrows resize the region");
  // Pointer capture requires a real OS pointer; substitute capture only for synthetic coordinate checks.
  const capture=canvas.setPointerCapture,release=canvas.releasePointerCapture;canvas.setPointerCapture=()=>{};canvas.releasePointerCapture=()=>{};
  try {
    const box=canvas.getBoundingClientRect(),dispatch=(type,x,y)=>canvas.dispatchEvent(new PointerEvent(type,{pointerId:7,isPrimary:true,button:0,clientX:box.left+box.width*x,clientY:box.top+box.height*y,pointerType:"touch",bubbles:true,cancelable:true}));
    dispatch("pointerdown",.1,.2);dispatch("pointermove",.4,.6);dispatch("pointerup",.4,.6);
    check(controls.settings().region.every((n,i)=>Math.abs(n-[.1,.2,.3,.4][i])<.001),"Touch pointer coordinates map to normalized source regions");
    dispatch("pointerdown",.2,.2);dispatch("pointermove",.8,.8);dispatch("pointercancel",.8,.8);
    check(Math.abs(controls.settings().region[2]-.3)<.001,"Cancelled gesture restores its previous selection");
  } finally {canvas.setPointerCapture=capture;canvas.releasePointerCapture=release;}
  change("img-camera","low");change("img-framing","wide");change("img-lighting","golden");
  check($("img-effective-prompt").value.includes("golden-hour") && $("img-effective-prompt").value.includes("whole scene"),"Visible prompt preview includes camera, framing, lighting and region scope");
  const nativeFetch=window.fetch, requests=[];
  window.fetch=(url,options)=>{if(String(url).includes("v1/images/" ) && options?.method==="POST") requests.push({url,body:JSON.parse(options.body)});return nativeFetch(url,options);};
  try {
    $("img-seed-mode").value="fixed";$("img-seed").value="0";updateImageSeedMode();
    await $("img-form").onsubmit(new Event("submit",{cancelable:true}));
    check(requests.length===1 && requests[0].url==="v1/images/edits" && requests[0].body.references.length===2 && requests[0].body.seed===0,"Actual edit submits the marked guide, controls and fixed zero seed");
    check(requests[0].body.prompt.includes("Image 2 is a marked copy") && requests[0].body.prompt.includes("golden-hour"),"Backend receives the same explicit edit instructions as the preview");
    const result=$("img-results").firstElementChild,recipe=StrataImage.read(StrataImage.fromBase64(result.querySelector("a").href.split(",")[1]));
    check(recipe.editing.camera==="low" && recipe.editing.lighting==="golden" && recipe.editing.region.length===4 && recipe.controlPrompt===$("img-prompt").value,"PNG recipe keeps selected controls, region and the original draft");
    check(recipe.references.length===2 && recipe.references.every(ref=>/^[a-f0-9]{64}$/.test(ref.sha256)) && !JSON.stringify(recipe).includes("data:image"),"Recipe retains guide provenance without private reference bytes");
    const selected=JSON.stringify(controls.settings());applyImageTemplate(StrataImage.starters[0],"make it green");
    check(JSON.stringify(controls.settings())===selected && StrataReferences.request()[0].data===before,"Applying a template preserves presets, region and original references");
    useImageRecipe(recipe);
    check($("img-prompt").value===recipe.controlPrompt && $("img-camera").value==="low" && !$("img-region-enabled").checked && StrataReferences.request().length===0,"Import restores the draft and presets but requires source and region selection again");
    prepared=controls.prepare($("img-prompt").value,[],"generate");
    check((prepared.prompt.match(/Selected image controls:/g)||[]).length===1,"Recipe reuse does not accumulate duplicate control instructions");
    await upload("new-source.png");await until(()=>$("img-region-canvas").width===600);mode("edit");
    $("img-region-enabled").checked=true;$("img-region-enabled").dispatchEvent(new Event("change"));$("img-region-center").click();
    await upload("second.png");await upload("third.png");
    const count=requests.length;await $("img-form").onsubmit(new Event("submit",{cancelable:true}));
    check(requests.length===count && StrataReferences.request().length===3,"Three references block a marked edit without dropping inputs or generating");
    $("img-reference-list").lastElementChild.querySelectorAll("button")[2].click();
    const newBytes=StrataImage.fromBase64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==");
    await upload("different.png",newBytes);$("img-reference-list").lastElementChild.querySelector("button").click();$("img-reference-list").children[1].querySelector("button").click();
    check(!controls.settings().region,"Replacing or reordering the source clears stale region coordinates");
    $("img-region-enabled").checked=false;$("img-region-enabled").dispatchEvent(new Event("change"));
    const signal=StrataReferences.begin();
    check($("img-edit-presets").disabled && $("img-region-controls").disabled && canvas.tabIndex===-1 && signal instanceof AbortSignal,"Generation locks presets and region editing");StrataReferences.end();
    check(!$("img-edit-presets").disabled,"Finishing or cancelling restores preset controls");
    $("img-preset-reset").click();check(!Object.values(controls.settings()).some(Boolean),"Reset presets removes optional directives");
    $("img-region-enabled").checked=true;$("img-region-enabled").dispatchEvent(new Event("change"));mode("generate");
    check(!controls.settings().region && controls.prepare("new scene",StrataReferences.request(),"generate").references.length===3,"Generate never sends an old edit-region guide");
    check(document.documentElement.scrollWidth<=innerWidth+1,"Expanded controls fit the viewport");
    const go=$("img-go").getBoundingClientRect();check(go.bottom<=innerHeight+1 && go.top>=0,"Generate remains visible with the expanded editing panel");
    // Leave subsequent regression suites in their normal default state.
    StrataReferences.restore({operation:"generate"});controls.restore({});
  } finally {window.fetch=nativeFetch;}
  return {passed:passed.length,checks:passed};
})();

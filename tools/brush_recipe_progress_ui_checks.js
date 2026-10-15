// Isolated fixture only. Replaces reference inputs and form settings.
(async () => {
  if(health.model!=="mobile-fixture-no-gpu")throw new Error("Use the isolated fixture");
  const passed=[],check=(ok,label)=>{if(!ok)throw new Error(label);passed.push(label);};
  const until=async f=>{for(let i=0;i<150;i++){if(f())return;await new Promise(r=>setTimeout(r,20));}throw new Error("Timed out");};
  await until(()=>StrataReferences.ready());showTab("images");StrataReferences.restore({operation:"edit"});StrataImageEditing.restore({});
  $("img-edit-controls").open=true;$("img-reference-panel").open=true;
  const paintSource=document.createElement("canvas");paintSource.width=600;paintSource.height=400;const p=paintSource.getContext("2d");p.fillStyle="skyblue";p.fillRect(0,0,600,400);
  const raw=StrataImage.fromBase64(paintSource.toDataURL("image/png").split(",")[1]);
  const recipe={schema:"strata.image.v1",prompt:"Original saved image prompt",seed:9876,size:"512x512",operation:"generate",settings:{steps:8},model:"fixture-origin"};
  const upload=async(bytes,name)=>{const dt=new DataTransfer();dt.items.add(new File([bytes],name,{type:"image/png"}));$("img-reference-files").files=dt.files;$("img-reference-files").dispatchEvent(new Event("change"));await until(()=>!$("img-operation").disabled);};
  await upload(StrataImage.write(raw,recipe),"recipe.png");await until(()=>$("img-region-canvas").width===600);
  const first=StrataReferences.request()[0],button=[...$("img-reference-list").querySelectorAll("button")].find(b=>b.textContent==="Load recipe");
  check(!!button,"Uploaded reference PNG exposes its embedded recipe without another picker");
  $("img-prompt").value="My current draft";check($("img-prompt").value!==recipe.prompt,"Uploading a reference never automatically overwrites the draft");
  await upload(raw,"plain.png");
  check($("img-reference-list").lastElementChild.textContent.includes("No Strata recipe found"),"Plain images remain usable with a clear no-recipe state");
  const refs=JSON.stringify(StrataReferences.request());
  [...$("img-reference-list").querySelectorAll("button")].find(b=>b.textContent==="Load recipe").click();
  check($("img-prompt").value===recipe.prompt && $("img-seed").value==="9876" && $("img-seed-mode").value==="fixed","Reference recipe loads the actual prompt and fixed seed");
  check(JSON.stringify(StrataReferences.request())===refs && $("img-operation").value==="edit","Reference recipe preserves all source bytes, order, roles and selected operation");
  check(!$("img-region-enabled").checked,"Loading a recipe does not silently apply stale region coordinates");
  check(!$("img-recipe-file").files.length,"Reference recipe reuse does not reopen or depend on a file picker");
  $("img-region-enabled").checked=true;$("img-region-enabled").dispatchEvent(new Event("change"));
  check($("img-region-tool").value==="brush","Brush is the default selection tool");
  const canvas=$("img-region-canvas"),capture=canvas.setPointerCapture,release=canvas.releasePointerCapture;
  canvas.setPointerCapture=()=>{};canvas.releasePointerCapture=()=>{};
  const stroke=(a,b,cancel=false)=>{const r=canvas.getBoundingClientRect();const event=(type,pt)=>canvas.dispatchEvent(new PointerEvent(type,{pointerId:9,isPrimary:true,button:0,pointerType:"touch",clientX:r.left+r.width*pt[0],clientY:r.top+r.height*pt[1],bubbles:true,cancelable:true}));event("pointerdown",a);event("pointermove",b);event(cancel?"pointercancel":"pointerup",b);};
  const maskPixel=async(x,y)=>{const out=StrataImageEditing.prepare("Change painted area",StrataReferences.request(),"edit"),image=new Image();image.src=out.references.at(-1).data;await image.decode();const c=document.createElement("canvas");c.width=image.width;c.height=image.height;const ctx=c.getContext("2d");ctx.drawImage(image,0,0);return {pixel:ctx.getImageData(x,y,1,1).data,out};};
  try {
    $("img-brush-size").value="20";$("img-brush-size").dispatchEvent(new Event("input"));
    stroke([.2,.5],[.8,.5]);
    let selection=await maskPixel(300,200);
    check(selection.pixel[0]===255 && selection.out.references[0].data===first.data && selection.out.references.at(-1).name==="region-mask.png","Brush sends a separate white-on-black mask and preserves original bytes");
    check((await maskPixel(300,20)).pixel[0]===0,"Unpainted surroundings stay black in the mask");
    check(selection.out.editing.regionMode==="brush" && selection.out.prompt.includes("White painted pixels") && !selection.out.prompt.includes("the red box at"),"Brush instructions identify painted pixels rather than a bounding box");
    $("img-brush-erase").checked=true;stroke([.5,.5],[.5,.5]);
    check((await maskPixel(300,200)).pixel[0]===0,"Eraser removes painted pixels from the actual submitted mask");
    $("img-region-undo").click();check((await maskPixel(300,200)).pixel[0]===255,"Undo restores the previous brush stroke");
    const before=JSON.stringify(StrataImageEditing.settings().region);stroke([.1,.1],[.9,.9],true);
    check(JSON.stringify(StrataImageEditing.settings().region)===before && (await maskPixel(60,40)).pixel[0]===0,"Cancelled touch gesture restores the mask and its bounds");
    $("img-brush-erase").checked=false;for(let i=0;i<7;i++)stroke([.1+i*.1,.2],[.1+i*.1,.2]);
    for(let i=0;i<5;i++)$("img-region-undo").click();check($("img-region-undo").disabled,"Undo is bounded to five strokes");
    $("img-region-clear").click();check(!StrataImageEditing.settings().region,"Clear removes all painted pixels and region metadata");
    $("img-region-center").click();check(StrataImageEditing.settings().regionMode==="brush","Keyboard-accessible center selection works in Brush mode");
  } finally {canvas.setPointerCapture=capture;canvas.releasePointerCapture=release;}
  // Busy request held in memory; verify visibility, cancellation and failure cleanup without GPU work.
  const nativeFetch=window.fetch;let request;
  window.fetch=(url,options)=>String(url).includes("v1/images/edits")?new Promise((resolve,reject)=>{request=JSON.parse(options.body);options.signal.addEventListener("abort",()=>reject(new DOMException("Stopped","AbortError")));}):nativeFetch(url,options);
  try {
    const pending=$("img-form").onsubmit(new Event("submit",{cancelable:true}));
    check(!$("img-progress").hidden && $("img-progress").position===-1 && $("img-progress").getAttribute("aria-busy")==="true","Generation displays an indeterminate accessible progress bar without a fake percentage");
    check($("img-reference-list").querySelectorAll("button:not(:disabled)").length===0 && $("img-region-controls").disabled,"Busy state locks reference recipe loading and brush editing");
    check(request.references.length===3 && request.prompt.includes("selection mask"),"Actual edit request includes brush mask with existing references");
    $("img-stop").click();await pending;check($("img-progress").hidden && !$("img-go").disabled,"Cancellation clears progress and restores controls");
    window.fetch=(url,options)=>String(url).includes("v1/images/edits")?Promise.resolve(new Response(JSON.stringify({error:{message:"Fixture error"}}),{status:500})):nativeFetch(url,options);
    await $("img-form").onsubmit(new Event("submit",{cancelable:true}));check($("img-progress").hidden && !$("img-go").disabled,"Failed requests also clear progress");
    window.fetch=nativeFetch;await $("img-form").onsubmit(new Event("submit",{cancelable:true}));
    check($("img-progress").hidden,"Successful generation clears progress");
    const result=$("img-results").firstElementChild,metadata=StrataImage.read(StrataImage.fromBase64(result.querySelector("a").href.split(",")[1]));
    check(metadata.editing.regionMode==="brush" && metadata.references.at(-1).name==="region-mask.png","Downloaded PNG recipe records brush mode and mask provenance without mask pixels");
  } finally {window.fetch=nativeFetch;}
  if(innerWidth>480){const a=$("img-lighting").getBoundingClientRect(),b=$("img-preset-reset").getBoundingClientRect();check(Math.abs(a.bottom-b.bottom)<1 && Math.abs(a.height-b.height)<1,"Reset presets aligns vertically with the lighting dropdown");}
  check(document.documentElement.scrollWidth<=innerWidth+1,"Brush controls and progress fit the viewport");
  const go=$("img-go").getBoundingClientRect();check(go.top>=0 && go.bottom<=innerHeight+1,"Primary action stays visible with expanded brush controls");
  useImageRecipe(recipe);check(StrataReferences.request().length===0 && $("img-operation").value==="generate","Standalone recipe loading retains its original clear-references behavior");
  StrataImageEditing.restore({});StrataReferences.restore({operation:"generate"});
  return {passed:passed.length,checks:passed};
})();

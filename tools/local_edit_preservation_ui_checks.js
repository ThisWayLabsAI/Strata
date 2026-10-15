// Isolated fixture only: no model calls or live history.
(async()=>{
  if(health.model!=="mobile-fixture-no-gpu")throw new Error("Use fixture");
  const passed=[],check=(ok,s)=>{if(!ok)throw new Error(s);passed.push(s);};
  const until=async f=>{for(let i=0;i<150;i++){if(f())return;await new Promise(r=>setTimeout(r,20));}throw new Error("Timed out");};
  await until(()=>StrataReferences.ready());showTab("images");StrataReferences.restore({operation:"edit"});StrataImageEditing.restore({});
  $("img-region-tool").value="brush";$("img-region-tool").dispatchEvent(new Event("change"));$("img-region-preserve").checked=true;
  const c=document.createElement("canvas");c.width=600;c.height=400;const ctx=c.getContext("2d");
  const gradient=ctx.createLinearGradient(0,0,600,400);gradient.addColorStop(0,"#d0e0b0");gradient.addColorStop(1,"#153020");ctx.fillStyle=gradient;ctx.fillRect(0,0,600,400);
  const original=ctx.getImageData(0,0,600,400).data;
  const bytes=StrataImage.fromBase64(c.toDataURL("image/png").split(",")[1]),dt=new DataTransfer();dt.items.add(new File([bytes],"original.png",{type:"image/png"}));
  $("img-reference-files").files=dt.files;$("img-reference-files").dispatchEvent(new Event("change"));await until(()=>!$("img-operation").disabled && $("img-region-canvas").width===600);
  $("img-edit-controls").open=true;$("img-region-enabled").checked=true;$("img-region-enabled").dispatchEvent(new Event("change"));$("img-region-center").click();
  $("img-prompt").value="Make the selected area blue.";$("img-prompt").dispatchEvent(new Event("input"));
  const blue=document.createElement("canvas");blue.width=512;blue.height=512;blue.getContext("2d").fillStyle="blue";blue.getContext("2d").fillRect(0,0,512,512);
  const fake=blue.toDataURL("image/png").split(",")[1];
  const pixels=async base64=>{const image=new Image();image.src="data:image/png;base64,"+base64;await image.decode();const out=document.createElement("canvas");out.width=image.width;out.height=image.height;const d=out.getContext("2d");d.drawImage(image,0,0);return {image,data:d.getImageData(0,0,image.width,image.height).data};};
  let prepared=StrataImageEditing.prepare($("img-prompt").value,StrataReferences.request(),"edit");
  check(typeof prepared.finalize==="function" && prepared.editing.preserveOutside,"Local edits enable pixel preservation by default");
  let result=await prepared.finalize(fake),out=await pixels(result.base64);
  check(result.size==="600x400" && out.image.width===600 && out.image.height===400,"Local output retains original resolution rather than the patch resolution");
  let changedOutside=0;for(let y=0;y<400;y++)for(let x=0;x<600;x++)if(x<150||x>=450||y<100||y>=300){const p=(y*600+x)*4;for(let k=0;k<4;k++)if(out.data[p+k]!==original[p+k]){changedOutside++;break;}}
  check(changedOutside===0,"Every unselected pixel in the final PNG is identical to the decoded original");
  check(out.data[(200*600+300)*4+2]===255,"Selected pixels receive the generated edit");
  $("img-region-clear").click();$("img-brush-size").value="4";
  const canvas=$("img-region-canvas"),capture=canvas.setPointerCapture,release=canvas.releasePointerCapture;canvas.setPointerCapture=()=>{};canvas.releasePointerCapture=()=>{};
  try{const r=canvas.getBoundingClientRect();for(const type of ["pointerdown","pointerup"])canvas.dispatchEvent(new PointerEvent(type,{pointerId:11,isPrimary:true,button:0,clientX:r.left+r.width*.5,clientY:r.top+r.height*.5,bubbles:true,cancelable:true}));}
  finally{canvas.setPointerCapture=capture;canvas.releasePointerCapture=release;}
  prepared=StrataImageEditing.prepare($("img-prompt").value,StrataReferences.request(),"edit");
  check(!!prepared.editing.crop && prepared.requestSize==="512x512" && prepared.references[0].name==="detail-source.png","Small brush selections submit a focused source crop at a bounded patch resolution");
  check(prepared.prompt===$("img-effective-prompt").value,"Prompt preview matches actual focused-edit instructions");
  result=await prepared.finalize(fake);out=await pixels(result.base64);
  check(out.data[0]===original[0] && out.data[(200*600+300)*4+2]===255,"Focused patch is placed back at the correct location without disturbing the scene");
  $("img-camera").value="side";$("img-camera").dispatchEvent(new Event("change"));
  prepared=StrataImageEditing.prepare("New side view",StrataReferences.request(),"edit");
  check($("img-region-preserve").disabled && !prepared.finalize && !prepared.editing.preserveOutside && !prepared.editing.crop,"Global camera changes disable local compositing and crop");
  $("img-preset-reset").click();$("img-region-preserve").checked=false;
  check(!StrataImageEditing.prepare("Edit",StrataReferences.request(),"edit").finalize,"User can explicitly disable protection for full-frame edits");
  $("img-region-preserve").checked=true;
  const nativeFetch=window.fetch;try{
    window.fetch=(url,options)=>String(url).includes("v1/images/edits")?Promise.resolve(new Response(JSON.stringify({size:"512x512",model:"fixture",operation:"edit",strata:{steps:8},data:[{seed:0,b64_json:fake}]}))):nativeFetch(url,options);
    await $("img-form").onsubmit(new Event("submit",{cancelable:true}));
    const recipe=StrataImage.read(StrataImage.fromBase64($("img-results").firstElementChild.querySelector("a").href.split(",")[1]));
    check(recipe.size==="600x400" && recipe.editing.preserveOutside && recipe.editing.sourceSize==="600x400","Displayed/downloaded PNG recipe records final resolution and local crop provenance");
  }finally{window.fetch=nativeFetch;}
  check($("img-progress").hidden && !$("img-go").disabled,"Local finalization completes before progress and busy controls clear");
  StrataImageEditing.restore({controlPrompt:"legacy",editing:{camera:"low"}});
  check($("img-camera").value==="" && $("img-elevation").value==="low","Legacy low/high/overhead recipes migrate to the elevation control");
  $("img-camera").value="rear";$("img-camera").dispatchEvent(new Event("change"));
  const combined=StrataImageEditing.prepare("same scene",StrataReferences.request(),"edit");
  check(combined.editing.camera==="rear" && combined.editing.elevation==="low" && combined.prompt.includes("behind the subject") && combined.prompt.includes("below eye level"),"Rear direction combines with low elevation in both request and recipe");
  check(!combined.finalize && !combined.editing.crop,"Elevation-only or combined global controls never receive a protected local crop");
  StrataReferences.restore({operation:"generate"});StrataImageEditing.restore({});
  return {passed:passed.length,checks:passed};
})();

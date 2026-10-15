// Optional prompt guidance. Original reference bytes are never painted over.
(() => {
  "use strict";
  const presets = {
    camera: [
      ["front", "Front", "View the subject from the front, showing its front-facing features."],
      ["three-quarter", "Three-quarter", "View the subject from a three-quarter direction, approximately 45 degrees from the front, showing its front and one side."],
      ["side", "Side profile", "Change to a new side-on camera viewpoint, approximately 90 degrees from the subject's front. Show its full side profile; do not keep the source's frontal view."],
      ["rear", "Rear", "Move the camera behind the subject and show its back. Its front-facing features should no longer face the camera."]],
    elevation: [
      ["eye", "Eye level", "Place the camera at the main subject's eye level, looking horizontally."],
      ["high", "High angle", "Place the camera above the subject, looking down at an angle."],
      ["low", "Low angle", "Place the camera below eye level, looking up at the subject."],
      ["overhead", "Overhead", "Move the camera directly above the scene, pointing vertically straight down. Show the tops of the subjects, not the source's frontal eye-level faces."]],
    framing: [
      ["close", "Close-up / tighter", "Use a tight close-up framing of the main subject, showing its important details."],
      ["medium", "Medium shot", "Use medium-shot framing of the main subject and its immediate surroundings."],
      ["wide", "Wide / farther back", "Move the camera farther back for a wide shot with more surrounding space."],
      ["full", "Full subject", "Frame the entire main subject with clear margins; do not crop its extremities."]],
    lighting: [
      ["soft", "Soft studio", "Use soft, diffused studio lighting with gentle shadows and balanced exposure."],
      ["overcast", "Overcast daylight", "Use neutral overcast daylight with soft natural shadows."],
      ["golden", "Golden hour", "Use warm, low-angle golden-hour sunlight with long soft shadows."],
      ["side", "Dramatic side light", "Use a strong directional side light with sculpted shadows and dramatic contrast."],
      ["rim", "Rim / backlight", "Use backlighting to create a clear rim of light around the subject, with gentle fill on the front."],
      ["high-key", "High key", "Use bright, even high-key lighting with restrained shadows, retaining highlight detail."],
      ["low-key", "Low key", "Use low-key lighting with deep shadows and selective illumination, retaining the subject's important details."],
      ["neon", "Neon / cinematic", "Use cinematic cyan and magenta practical neon lighting with colored reflections."]]
  };
  const cropInstruction="Image 1 is a focused crop of the original source, enlarged so a small correction is visible. Apply only the requested edit in the selected area; preserve the original rendering style.\n\n";
  function compose(prompt, settings, operation, count) {
    settings = StrataImage.editingSettings(settings);
    if(["high","low","overhead"].includes(settings.camera)) {settings.elevation ||= settings.camera;delete settings.camera;}
    const lines = [];
    for (const key of Object.keys(presets)) if (settings[key]) lines.push(presets[key].find(p => p[0] === settings[key])[2]);
    if (settings.region) {
      if (operation !== "edit" || count < 1 || count > 2) throw new Error("A marked edit needs a source and one free reference slot (at most two uploaded references).");
      const [x,y,w,h] = settings.region.map(n => Math.round(n * 100));
      lines.unshift(settings.regionMode === "brush" ?
        `Edit image 1, the unmarked original. Image ${count + 1} is a black-and-white selection mask, NOT a scene or style reference. White painted pixels identify exactly where to apply the requested replacement or change; black pixels identify areas to preserve as closely as possible. Do not render the mask or paint marks in the output.` :
        `Edit image 1, the unmarked original. Image ${count + 1} is a marked copy of image 1 used ONLY to locate the target: the red box at left ${x}%, top ${y}%, width ${w}%, height ${h}%. Apply the requested local replacement or change inside this box. Do not include the red box or any guide marks in the output.`);
      lines.push(settings.camera || settings.elevation || settings.framing || settings.lighting ?
        "The selected camera, framing and lighting changes apply to the whole scene; the selection identifies the local edit target." :
        "Preserve the scene and unselected areas as closely as possible.");
    }
    if (!lines.length) return prompt;
    if (operation === "edit") lines.push(settings.region ?
      "The requested change inside the selection takes priority: do not keep the original color, material or shape there if the user asks to change it. Match the existing rendering style, soft shading and surrounding texture. Do not add sharpening or photorealistic texture. Keep the subject's design outside the selection." :
      "Preserve the subject's identity, recognizable design, original rendering style, smoothness, fur texture and depth of field unless explicitly requested otherwise. Do not add sharpening or photorealistic texture. These selected controls override conflicting camera or lighting wording in the draft.");
    return prompt + "\n\nSelected image controls:\n" + lines.join("\n");
  }
  function blendSelection(source, edited, selection) {
    if(source.length!==edited.length || source.length!==selection.length || source.length%4) throw new Error("Mismatched edit pixel buffers.");
    for(let p=0;p<source.length;p+=4) {
      const weight=selection[p+3]/255;
      if(!weight)continue;
      for(let channel=0;channel<4;channel++)source[p+channel]=Math.round(source[p+channel]*(1-weight)+edited[p+channel]*weight);
    }
    return source;
  }
  function focusCrop(region,width,height) {
    if(!region || region[2]*region[3]>=.1) return null;
    const extent=Math.max(region[2]*width,region[3]*height),short=Math.min(width,height);
    if(extent>short*.55)return null;
    const side=Math.min(short,Math.ceil(Math.max(extent*3,short*.25)));
    return {x:Math.max(0,Math.min(width-side,Math.round((region[0]+region[2]/2)*width-side/2))),
      y:Math.max(0,Math.min(height-side,Math.round((region[1]+region[3]/2)*height-side/2))),width:side,height:side};
  }
  function colorEdit(prompt,originalColor,count) {
    const match=/^(?:change|turn|make)\s+(?:the\s+)?(?:selected|painted|marked)\s+(?:area|region)\s+(?:to|into)\s+(white|black|red|blue|green|yellow|orange|brown|gray|grey|pink|purple)\s+(fur|hair)\.?$/i.exec(prompt.trim());
    if(!match || !["BLACK","WHITE"].includes(originalColor))return null;
    const color=match[1].toUpperCase(),material=match[2].toLowerCase();
    return `${prompt}\nImage 1 is a cropped close-up of the source. Image ${count+1} is a selection mask. Replace the ${originalColor} ${material} in the WHITE mask region with clean ${color} ${material}, matching the existing soft ${color.toLowerCase()} ${material} where present. This is a ${material} color correction, not a new ${material} texture. Keep the original smooth rendering style, shading and lighting. Preserve all other ${material} outside the mask. Do not render the mask in the output.`;
  }
  globalThis.StrataImageEditing = {presets, compose, blendSelection, focusCrop, colorEdit};
  if (typeof document === "undefined") return;

  const $ = id => document.getElementById(id), canvas = $("img-region-canvas"), context = canvas.getContext("2d");
  const mask = document.createElement("canvas"), paint = mask.getContext("2d", {willReadFrequently:true}), history = [];
  const brush = () => $("img-region-tool").value === "brush";
  let state = {busy:false, ready:false, refs:[], operation:"generate"}, source = null, image = null, region = null, drag = null, loadError = "";
  const settings = () => ({...Object.fromEntries(Object.keys(presets).map(key => [key, $("img-" + key).value])),
    ...($("img-region-enabled").checked && state.operation === "edit" && region ? {region:[...region], ...(brush() ? {regionMode:"brush"} : {})} : {})});
  for (const [key, values] of Object.entries(presets)) {
    $("img-" + key).add(new Option("Unchanged / prompt decides", ""));
    values.forEach(([id, name]) => $("img-" + key).add(new Option(name, id)));
    $("img-" + key).onchange = refresh;
  }
  function draw() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (image) context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (brush()) {
      context.save(); context.globalAlpha = .5; context.drawImage(mask,0,0); context.restore();
    } else if (region) {
      const [x,y,w,h] = region, line = Math.max(3, Math.round(canvas.width / 180));
      context.lineWidth = line + 3; context.strokeStyle = "white";
      context.strokeRect(x*canvas.width,y*canvas.height,w*canvas.width,h*canvas.height);
      context.lineWidth = line; context.strokeStyle = "#ff0000";
      context.strokeRect(x*canvas.width,y*canvas.height,w*canvas.width,h*canvas.height);
    }
  }
  function clearSelection() { region = null; paint.clearRect(0,0,mask.width,mask.height); history.length = 0; }
  function bounds() {
    const pixels = paint.getImageData(0,0,mask.width,mask.height).data;
    let left=mask.width,top=mask.height,right=-1,bottom=-1;
    for(let y=0;y<mask.height;y++) for(let x=0;x<mask.width;x++) if(pixels[(y*mask.width+x)*4+3]>0) {
      left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
    }
    region = right<0 ? null : [left/mask.width,top/mask.height,(right-left+1)/mask.width,(bottom-top+1)/mask.height];
  }
  function selectedColor() {
    const probe=document.createElement("canvas");probe.width=mask.width;probe.height=mask.height;
    const ctx=probe.getContext("2d");ctx.drawImage(image,0,0,probe.width,probe.height);
    const data=ctx.getImageData(0,0,probe.width,probe.height).data, selection=paint.getImageData(0,0,mask.width,mask.height).data;
    let black=0,white=0,total=0;
    for(let p=0;p<data.length;p+=4)if(selection[p+3]>128){const light=(data[p]+data[p+1]+data[p+2])/3;total++;if(light<90)black++;else if(light>190)white++;}
    return black>total*.55?"BLACK":white>total*.55?"WHITE":null;
  }
  function focusedColorPrompt(prompt,count) {
    if(!colorEdit(prompt,"BLACK",count))return null;
    return colorEdit(prompt,selectedColor(),count);
  }
  function remember(snapshot) { history.push(snapshot); if(history.length>5) history.shift(); }
  function stroke(from,to) {
    const width = Math.min(mask.width,mask.height)*Number($("img-brush-size").value)/100;
    paint.save(); paint.globalCompositeOperation = $("img-brush-erase").checked ? "destination-out" : "source-over";
    paint.fillStyle = paint.strokeStyle = "#ff0000"; paint.lineWidth=width; paint.lineCap="round";paint.lineJoin="round";
    paint.beginPath();paint.moveTo(from[0]*mask.width,from[1]*mask.height);paint.lineTo(to[0]*mask.width,to[1]*mask.height);paint.stroke();
    paint.beginPath();paint.arc(to[0]*mask.width,to[1]*mask.height,width/2,0,2*Math.PI);paint.fill();paint.restore();
  }
  function refresh() {
    const available = state.ready && state.operation === "edit" && !!source;
    $("img-edit-presets").disabled = state.busy;
    $("img-region-controls").disabled = state.busy || !available;
    $("img-region-editor").hidden = !available || !$("img-region-enabled").checked;
    canvas.tabIndex = state.busy ? -1 : 0;
    $("img-region-undo").disabled = state.busy || !brush() || !history.length;
    $("img-brush-size").disabled = !brush(); $("img-brush-erase").disabled = !brush();
    $("img-brush-size-label").value = $("img-brush-size").value + "%";
    const global = ["camera","elevation","framing","lighting"].some(key => $("img-"+key).value);
    $("img-region-preserve").disabled = global;
    $("img-region-preserve-help").textContent = global ? "Camera, elevation, framing or lighting applies globally. Unselected-area protection is disabled for this request." : "Local edits keep source resolution and paste only selected pixels back into the original. Small brush selections are enlarged for the model.";
    let status = "Select Edit and upload a source to mark a region.";
    if (available) status = !$("img-region-enabled").checked ? "Region marking is optional. Presets can be used with or without a region." :
      loadError || (!image ? "Loading source…" : !region ? "Paint a region, draw a box, or select the center before editing." :
        `Region: left ${Math.round(region[0]*100)}%, top ${Math.round(region[1]*100)}%, width ${Math.round(region[2]*100)}%, height ${Math.round(region[3]*100)}%. Describe the change in Prompt. Other pixels may also change.`);
    if (available && $("img-region-enabled").checked && state.refs.length > 2) status = "Region guide needs one free reference slot. Remove a reference or turn off region marking; your references have been kept.";
    $("img-region-status").textContent = status;
    let preview;
    try {
      const selected=settings();preview = compose($("img-prompt").value.trim(), selected, state.operation, state.refs.length);
      if(image && selected.region && brush() && $("img-region-preserve").checked && !global && focusCrop(selected.region,image.naturalWidth,image.naturalHeight))preview=focusedColorPrompt($("img-prompt").value.trim(),state.refs.length)||cropInstruction+preview;
    }
    catch (error) { preview = error.message; }
    $("img-effective-label").hidden = !Object.values(settings()).some(Boolean);
    $("img-effective-prompt").value = preview;
    draw();
  }
  function sync(value) {
    state = {...value, refs:value.refs.slice()};
    const next = state.refs[0]?.data || null;
    if (source !== next) {
      const hadRegion = !!region;
      source = next; image = null; clearSelection(); drag = null; loadError = "";
      if (hadRegion) toast("info", "Region cleared", "The source changed. Mark the region on the new source.");
      if (source) {
        const expected = source, decoded = new Image(); decoded.src = source;
        decoded.decode().then(() => {
          if (source !== expected) return;
          image = decoded;
          const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          mask.width=canvas.width; mask.height=canvas.height;
          refresh();
        }).catch(() => { if (source === expected) { loadError = "Could not load source for region marking. Re-upload it or turn off the region."; refresh(); } });
      }
    }
    refresh();
  }
  const allowed = () => !state.busy && state.operation === "edit" && $("img-region-enabled").checked && image && state.refs.length <= 2;
  function center() { if (allowed() && !drag) {
    if(brush()) { remember(paint.getImageData(0,0,mask.width,mask.height));paint.fillStyle="#ff0000";paint.fillRect(mask.width*.25,mask.height*.25,mask.width*.5,mask.height*.5);bounds(); }
    else region = [.25,.25,.5,.5]; refresh();
  } }
  $("img-region-tool").onchange = () => {
    if(drag) { $("img-region-tool").value=drag.snapshot?"brush":"box"; return; }
    if (!state.busy) { clearSelection();refresh(); }
  };
  $("img-brush-size").oninput = refresh;
  $("img-region-undo").onclick = () => { if(!state.busy && !drag && history.length) {paint.putImageData(history.pop(),0,0);bounds();refresh();} };
  $("img-region-enabled").onchange = refresh;
  $("img-region-preserve").onchange = refresh;
  $("img-region-center").onclick = center;
  $("img-region-clear").onclick = () => { if (!state.busy && !drag) { clearSelection(); refresh(); } };
  $("img-preset-reset").onclick = () => { for (const key of Object.keys(presets)) $("img-" + key).value = ""; refresh(); };
  $("img-prompt").addEventListener("input", refresh);
  const point = event => { const box = canvas.getBoundingClientRect(); return [Math.max(0,Math.min(1,(event.clientX-box.left)/box.width)),Math.max(0,Math.min(1,(event.clientY-box.top)/box.height))]; };
  canvas.onpointerdown = event => {
    if (!allowed() || !event.isPrimary || event.button !== 0) return;
    event.preventDefault(); canvas.focus({preventScroll:true}); drag = {id:event.pointerId,start:point(event),before:region, snapshot:brush()?paint.getImageData(0,0,mask.width,mask.height):null}; canvas.setPointerCapture(event.pointerId);
    if(brush()) {stroke(drag.start,drag.start);draw();}
  };
  canvas.onpointermove = event => {
    if (!drag || drag.id !== event.pointerId || !allowed()) return;
    const next=point(event);
    if(brush()) { stroke(drag.start,next);drag.start=next; }
    else { const [x,y]=next,[a,b]=drag.start;region=[Math.min(x,a),Math.min(y,b),Math.abs(x-a),Math.abs(y-b)]; }
    draw();
  };
  canvas.onpointerup = event => {
    if (!drag || drag.id !== event.pointerId) return;
    if(brush()) {stroke(drag.start,point(event));remember(drag.snapshot);bounds();}
    else if (!region || region[2] < .01 || region[3] < .01) region = drag.before;
    drag = null; canvas.releasePointerCapture(event.pointerId); refresh();
  };
  canvas.onpointercancel = canvas.onlostpointercapture = () => { if (drag) { if(drag.snapshot)paint.putImageData(drag.snapshot,0,0); region = drag.before; drag = null; refresh(); } };
  canvas.onkeydown = event => {
    if (!allowed()) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); center(); return; }
    if (brush() || !region || !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) return;
    event.preventDefault(); const r = [...region], horizontal = ["ArrowLeft","ArrowRight"].includes(event.key), axis = horizontal ? 0 : 1;
    const delta = ["ArrowLeft","ArrowUp"].includes(event.key) ? -.02 : .02;
    if (event.shiftKey) r[axis+2] = Math.max(.02, Math.min(1-r[axis], r[axis+2]+delta));
    else r[axis] = Math.max(0, Math.min(1-r[axis+2], r[axis]+delta));
    region = r; refresh();
  };
  function prepare(prompt, references, operation) {
    if (drag) throw new Error("Finish drawing the region before submitting.");
    const enabled = $("img-region-enabled").checked && operation === "edit";
    if (enabled && (!region || !image || source !== references[0]?.data)) throw new Error("Mark a region on the current source, or turn off region marking.");
    const editing = StrataImage.editingSettings(settings());
    const protect = !!editing.region && $("img-region-preserve").checked && !["camera","elevation","framing","lighting"].some(key=>editing[key]);
    if(editing.region) editing.preserveOutside = protect;
    let effective = compose(prompt, editing, operation, references.length);
    if (effective.length > 16384) throw new Error("Prompt plus selected image controls exceeds 16,384 characters. Shorten the prompt.");
    const result = references.slice();
    const original=image, crop=protect && brush()?focusCrop(editing.region,image.naturalWidth,image.naturalHeight):null;
    if (editing.region) {
      draw();
      let guide=canvas;
      if(brush()) {
        guide=document.createElement("canvas");guide.width=mask.width;guide.height=mask.height;const ctx=guide.getContext("2d");
        ctx.drawImage(mask,0,0);ctx.globalCompositeOperation="source-in";ctx.fillStyle="white";ctx.fillRect(0,0,guide.width,guide.height);
        ctx.globalCompositeOperation="destination-over";ctx.fillStyle="black";ctx.fillRect(0,0,guide.width,guide.height);
      }
      if(crop) {
        const detail=document.createElement("canvas");detail.width=crop.width;detail.height=crop.height;
        detail.getContext("2d").drawImage(original,crop.x,crop.y,crop.width,crop.height,0,0,crop.width,crop.height);
        result[0]={...result[0],data:detail.toDataURL("image/png"),name:"detail-source.png"};
        const localGuide=document.createElement("canvas");localGuide.width=crop.width;localGuide.height=crop.height;
        localGuide.getContext("2d").drawImage(guide,crop.x*guide.width/original.naturalWidth,crop.y*guide.height/original.naturalHeight,
          crop.width*guide.width/original.naturalWidth,crop.height*guide.height/original.naturalHeight,0,0,crop.width,crop.height);
        guide=localGuide;
        editing.crop=[crop.x/original.naturalWidth,crop.y/original.naturalHeight,crop.width/original.naturalWidth,crop.height/original.naturalHeight];
        editing.sourceSize=`${original.naturalWidth}x${original.naturalHeight}`;
        effective=focusedColorPrompt(prompt,references.length)||cropInstruction+effective;
      }
      const data = guide.toDataURL("image/png");
      const size = StrataImage.fromBase64(data.split(",")[1]).length;
      if (size > 8_000_000 || references.reduce((n,r) => n + StrataImage.fromBase64(r.data.split(",")[1] || r.data).length,0) + size > 20_000_000) throw new Error("The marked guide exceeds the reference size limit. Resize references or turn off region marking.");
      result.push({data,name:brush()?"region-mask.png":"region-guide.png",role:"composition"});
    }
    let finalize;
    if(protect) {
      const selection = document.createElement("canvas");selection.width=canvas.width;selection.height=canvas.height;
      const ctx=selection.getContext("2d");
      if(brush())ctx.drawImage(mask,0,0);
      else {const [x,y,w,h]=region;ctx.fillStyle="white";ctx.fillRect(x*selection.width,y*selection.height,w*selection.width,h*selection.height);}
      finalize = async base64 => {
        const generated = new Image();generated.src="data:image/png;base64,"+base64;await generated.decode();
        const output=document.createElement("canvas");output.width=original.naturalWidth;output.height=original.naturalHeight;
        const draw=output.getContext("2d",{willReadFrequently:true});draw.drawImage(original,0,0);
        const sourcePixels=draw.getImageData(0,0,output.width,output.height);
        draw.clearRect(0,0,output.width,output.height);
        if(crop)draw.drawImage(generated,crop.x,crop.y,crop.width,crop.height);
        else draw.drawImage(generated,0,0,output.width,output.height);
        const edited=draw.getImageData(0,0,output.width,output.height);
        draw.clearRect(0,0,output.width,output.height);draw.drawImage(selection,0,0,output.width,output.height);
        const selectionPixels=draw.getImageData(0,0,output.width,output.height);
        // Feather inward only: zero-alpha source pixels must never receive generated pixels.
        draw.clearRect(0,0,output.width,output.height);draw.filter="blur(2px)";draw.drawImage(selection,0,0,output.width,output.height);draw.filter="none";
        const soft=draw.getImageData(0,0,output.width,output.height).data;
        for(let p=3;p<soft.length;p+=4)selectionPixels.data[p]=Math.round(selectionPixels.data[p]*Math.max(0,Math.min(1,(soft[p]-127.5)/127.5)));
        blendSelection(sourcePixels.data,edited.data,selectionPixels.data);
        draw.putImageData(sourcePixels,0,0);
        return {base64:output.toDataURL("image/png").split(",")[1],size:`${output.width}x${output.height}`};
      };
    }
    if(effective.length>16384)throw new Error("Prompt plus edit instructions exceeds 16,384 characters. Shorten the prompt.");
    return {prompt:effective, references:result, editing:Object.keys(editing).length ? editing : undefined, finalize,requestSize:crop?"512x512":undefined};
  }
  function restore(value) {
    const old=value.editing || {},legacy=["high","low","overhead"].includes(old.camera);
    const restored={...old,...(legacy?{camera:"",elevation:old.elevation || old.camera}:{})};
    $("img-region-preserve").checked = old.preserveOutside !== false;
    for (const key of Object.keys(presets)) $("img-" + key).value = value.controlPrompt !== undefined ? restored[key] || "" : "";
    clearSelection(); $("img-region-enabled").checked = false; refresh();
    if (value.editing?.region) toast("info", "Reselect the edit region", "This recipe records a region. Upload the original source and mark it again; guide pixels are not stored in the recipe.", 8000);
  }
  Object.assign(globalThis.StrataImageEditing, {sync, prepare, restore, settings, refresh});
  StrataReferences.refreshControls();
})();

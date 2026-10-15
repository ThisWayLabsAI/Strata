// Optional prompt guidance. Original reference bytes are never painted over.
(() => {
  "use strict";
  const presets = {
    camera: [
      ["front", "Front", "View the subject from the front at eye level."],
      ["three-quarter", "Three-quarter", "View the subject from a three-quarter angle at eye level."],
      ["side", "Side profile", "View the subject in a full side profile at eye level."],
      ["rear", "Rear", "View the subject from behind at eye level."],
      ["high", "High angle", "Place the camera above the subject, looking down at an angle."],
      ["low", "Low angle", "Place the camera below eye level, looking up at the subject."],
      ["overhead", "Overhead", "Use a directly overhead, top-down camera view."]],
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
  function compose(prompt, settings, operation, count) {
    settings = StrataImage.editingSettings(settings);
    const lines = [];
    for (const key of Object.keys(presets)) if (settings[key]) lines.push(presets[key].find(p => p[0] === settings[key])[2]);
    if (settings.region) {
      if (operation !== "edit" || count < 1 || count > 2) throw new Error("A marked edit needs a source and one free reference slot (at most two uploaded references).");
      const [x,y,w,h] = settings.region.map(n => Math.round(n * 100));
      lines.unshift(`Edit image 1, the unmarked original. Image ${count + 1} is a marked copy of image 1 used ONLY to locate the target: the red box at left ${x}%, top ${y}%, width ${w}%, height ${h}%. Apply the requested local replacement or change inside this box. Do not include the red box or any guide marks in the output.`);
      lines.push(settings.camera || settings.framing || settings.lighting ?
        "The selected camera, framing and lighting changes apply to the whole scene; the box identifies the local edit target." :
        "Preserve the scene and unselected areas as closely as possible.");
    }
    if (!lines.length) return prompt;
    if (operation === "edit") lines.push("Preserve the subject's identity, recognizable design and materials unless the requested changes require otherwise. These selected controls override conflicting camera or lighting wording in the draft.");
    return prompt + "\n\nSelected image controls:\n" + lines.join("\n");
  }
  globalThis.StrataImageEditing = {presets, compose};
  if (typeof document === "undefined") return;

  const $ = id => document.getElementById(id), canvas = $("img-region-canvas"), context = canvas.getContext("2d");
  let state = {busy:false, ready:false, refs:[], operation:"generate"}, source = null, image = null, region = null, drag = null, loadError = "";
  const settings = () => ({...Object.fromEntries(Object.keys(presets).map(key => [key, $("img-" + key).value])),
    ...($("img-region-enabled").checked && state.operation === "edit" && region ? {region:[...region]} : {})});
  for (const [key, values] of Object.entries(presets)) {
    $("img-" + key).add(new Option("Unchanged / prompt decides", ""));
    values.forEach(([id, name]) => $("img-" + key).add(new Option(name, id)));
    $("img-" + key).onchange = refresh;
  }
  function draw() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (image) context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (region) {
      const [x,y,w,h] = region, line = Math.max(3, Math.round(canvas.width / 180));
      context.lineWidth = line + 3; context.strokeStyle = "white";
      context.strokeRect(x*canvas.width,y*canvas.height,w*canvas.width,h*canvas.height);
      context.lineWidth = line; context.strokeStyle = "#ff0000";
      context.strokeRect(x*canvas.width,y*canvas.height,w*canvas.width,h*canvas.height);
    }
  }
  function refresh() {
    const available = state.ready && state.operation === "edit" && !!source;
    $("img-edit-presets").disabled = state.busy;
    $("img-region-controls").disabled = state.busy || !available;
    $("img-region-editor").hidden = !available || !$("img-region-enabled").checked;
    canvas.tabIndex = state.busy ? -1 : 0;
    let status = "Select Edit and upload a source to mark a region.";
    if (available) status = !$("img-region-enabled").checked ? "Region marking is optional. Presets can be used with or without a region." :
      loadError || (!image ? "Loading source…" : !region ? "Draw a box or select the center before editing." :
        `Region: left ${Math.round(region[0]*100)}%, top ${Math.round(region[1]*100)}%, width ${Math.round(region[2]*100)}%, height ${Math.round(region[3]*100)}%. Describe the change in Prompt. Other pixels may also change.`);
    if (available && $("img-region-enabled").checked && state.refs.length > 2) status = "Region guide needs one free reference slot. Remove a reference or turn off region marking; your references have been kept.";
    $("img-region-status").textContent = status;
    let preview;
    try { preview = compose($("img-prompt").value.trim(), settings(), state.operation, state.refs.length); }
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
      source = next; image = null; region = null; drag = null; loadError = "";
      if (hadRegion) toast("info", "Region cleared", "The source changed. Mark the region on the new source.");
      if (source) {
        const expected = source, decoded = new Image(); decoded.src = source;
        decoded.decode().then(() => {
          if (source !== expected) return;
          image = decoded;
          const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          refresh();
        }).catch(() => { if (source === expected) { loadError = "Could not load source for region marking. Re-upload it or turn off the region."; refresh(); } });
      }
    }
    refresh();
  }
  const allowed = () => !state.busy && state.operation === "edit" && $("img-region-enabled").checked && image && state.refs.length <= 2;
  function center() { if (allowed()) { region = [.25,.25,.5,.5]; refresh(); } }
  $("img-region-enabled").onchange = refresh;
  $("img-region-center").onclick = center;
  $("img-region-clear").onclick = () => { if (!state.busy) { region = null; refresh(); } };
  $("img-preset-reset").onclick = () => { for (const key of Object.keys(presets)) $("img-" + key).value = ""; refresh(); };
  $("img-prompt").addEventListener("input", refresh);
  const point = event => { const box = canvas.getBoundingClientRect(); return [Math.max(0,Math.min(1,(event.clientX-box.left)/box.width)),Math.max(0,Math.min(1,(event.clientY-box.top)/box.height))]; };
  canvas.onpointerdown = event => {
    if (!allowed() || !event.isPrimary || event.button !== 0) return;
    event.preventDefault(); canvas.focus({preventScroll:true}); drag = {id:event.pointerId,start:point(event),before:region}; canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = event => {
    if (!drag || drag.id !== event.pointerId || !allowed()) return;
    const [x,y] = point(event), [a,b] = drag.start; region = [Math.min(x,a),Math.min(y,b),Math.abs(x-a),Math.abs(y-b)]; draw();
  };
  canvas.onpointerup = event => {
    if (!drag || drag.id !== event.pointerId) return;
    if (!region || region[2] < .01 || region[3] < .01) region = drag.before;
    drag = null; canvas.releasePointerCapture(event.pointerId); refresh();
  };
  canvas.onpointercancel = canvas.onlostpointercapture = () => { if (drag) { region = drag.before; drag = null; refresh(); } };
  canvas.onkeydown = event => {
    if (!allowed()) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); center(); return; }
    if (!region || !["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) return;
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
    const effective = compose(prompt, editing, operation, references.length);
    if (effective.length > 16384) throw new Error("Prompt plus selected image controls exceeds 16,384 characters. Shorten the prompt.");
    const result = references.slice();
    if (editing.region) {
      draw(); const data = canvas.toDataURL("image/png");
      const size = StrataImage.fromBase64(data.split(",")[1]).length;
      if (size > 8_000_000 || references.reduce((n,r) => n + StrataImage.fromBase64(r.data.split(",")[1] || r.data).length,0) + size > 20_000_000) throw new Error("The marked guide exceeds the reference size limit. Resize references or turn off region marking.");
      result.push({data,name:"region-guide.png",role:"composition"});
    }
    return {prompt:effective, references:result, editing:Object.keys(editing).length ? editing : undefined};
  }
  function restore(value) {
    for (const key of Object.keys(presets)) $("img-" + key).value = value.controlPrompt !== undefined ? value.editing?.[key] || "" : "";
    region = null; $("img-region-enabled").checked = false; refresh();
    if (value.editing?.region) toast("info", "Reselect the edit region", "This recipe records a region. Upload the original source and mark it again; guide pixels are not stored in the recipe.", 8000);
  }
  Object.assign(globalThis.StrataImageEditing, {sync, prepare, restore, settings, refresh});
  StrataReferences.refreshControls();
})();

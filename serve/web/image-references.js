// Reference bytes stay in memory. Remote imports never send the Strata API key.
(() => {
  "use strict";
  const refs = [], MAX = 8_000_000, TOTAL = 20_000_000;
  let ready = false, reading = false, running = false, controller = null;
  const notify = error => toast("error", "Reference image", error.message || String(error), 8000);
  function render() {
    const edit = $("img-operation").value === "edit", list = $("img-reference-list");
    list.replaceChildren();
    refs.forEach((ref, index) => {
      if (edit) { if (!index) ref.role = "source"; else if (ref.role === "source") ref.role = "identity"; }
      const card = document.createElement("div"); card.className = "img-reference-card";
      const preview = document.createElement("img"); preview.src = ref.data; preview.alt = `Image ${index + 1}: ${ref.name}`;
      const label = document.createElement("span"); label.textContent = `Image ${index + 1}: ${ref.name}`;
      const role = document.createElement("select"); role.className = "st-input"; role.setAttribute("aria-label", `Image ${index + 1} role`);
      for (const value of ["source", "identity", "style", "composition"]) {
        if (edit && index && value === "source") continue;
        role.add(new Option(value, value));
      }
      role.value = ref.role; role.disabled = running || reading || (edit && index === 0); role.onchange = () => { ref.role = role.value; window.refreshImageTemplateContext?.(); };
      const actions = document.createElement("div"); actions.className = "img-template-actions";
      for (const [text, action, disabled] of [
        ["Move up", () => { [refs[index - 1], refs[index]] = [refs[index], refs[index - 1]]; render(); }, !index],
        ["Move down", () => { [refs[index + 1], refs[index]] = [refs[index], refs[index + 1]]; render(); }, index === refs.length - 1],
        ["Remove", () => { refs.splice(index, 1); render(); }, false]]) {
        const button = document.createElement("button"); button.type = "button"; button.className = "st-btn st-btn--secondary";
        button.textContent = text; button.disabled = running || reading || disabled; button.onclick = action; actions.append(button);
      }
      card.append(preview, label, role, actions); list.append(card);
    });
    $("img-reference-inputs").disabled = !ready || reading || running;
    $("img-reference-upload").disabled = !ready || reading || running;
    $("img-operation").disabled = reading || running;
    $("img-go").textContent = edit ? "Edit image" : "Generate";
    $("img-go").disabled = running || reading || (edit && (!ready || !refs.length));
    $("img-stop").hidden = !running;
    window.refreshImageTemplateContext?.();
    window.StrataImageEditing?.sync({busy: running || reading, ready, refs, operation: $("img-operation").value});
  }
  async function add(file) {
    if (!ready) throw new Error("Reference editing is not configured on this server.");
    if (refs.length >= 3 || !file.size || file.size > MAX || refs.reduce((n, r) => n + r.size, 0) + file.size > TOTAL) throw new Error("Use up to 3 images, 8 MB each and 20 MB total.");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a still PNG, JPEG or WebP image.");
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("Could not read image.")); reader.readAsDataURL(file);
    });
    const image = new Image(); image.src = data; await image.decode();
    if (image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error("Use an image of at most 16 megapixels.");
    refs.push({data, name: (file.name || "reference").slice(0, 160).replace(/[\x00-\x1f]/g, ""), role: refs.length ? "identity" : "source", size: file.size});
  }
  async function importing(action) {
    if (reading || running) return;
    reading = true; render();
    try { await action(); $("img-reference-panel").open = true; }
    catch (error) { notify(error); }
    finally { reading = false; render(); }
  }
  const upload = $("img-reference-upload");
  const importFiles = files => importing(async () => {
    for (const file of files) await add(file);
  });
  upload.onclick = () => $("img-reference-files").click();
  $("img-reference-files").onchange = () => {
    const files = [...$("img-reference-files").files]; $("img-reference-files").value = "";
    return importFiles(files);
  };
  for (const type of ["dragenter", "dragover"]) upload.addEventListener(type, event => {
    event.preventDefault(); event.stopPropagation();
    const accepts = !upload.disabled && [...(event.dataTransfer?.types || [])].includes("Files");
    upload.classList.toggle("dragging", accepts);
    if (event.dataTransfer) event.dataTransfer.dropEffect = accepts ? "copy" : "none";
  });
  upload.addEventListener("dragleave", event => {
    if (!upload.contains(event.relatedTarget)) upload.classList.remove("dragging");
  });
  upload.addEventListener("drop", event => {
    event.preventDefault(); event.stopPropagation(); upload.classList.remove("dragging");
    if (!upload.disabled && event.dataTransfer?.files.length) importFiles([...event.dataTransfer.files]);
  });
  $("img-reference-add-url").onclick = () => importing(async () => {
    const url = new URL($("img-reference-url").value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an HTTP or HTTPS image URL without credentials.");
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 30000);
    try {
      const response = await fetch(url.href, {mode: "cors", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: abort.signal});
      if (!response.ok || Number(response.headers.get("content-length")) > MAX) throw new Error("Image unavailable or over 8 MB.");
      const reader = response.body.getReader(), parts = []; let length = 0;
      while (true) {
        const {value, done} = await reader.read(); if (done) break;
        length += value.length; if (length > MAX) { await reader.cancel(); throw new Error("Image exceeds 8 MB."); }
        parts.push(value);
      }
      await add(new File(parts, "url-reference", {type: response.headers.get("content-type")?.split(";")[0].trim()}));
      $("img-reference-url").value = "";
    } catch (error) { throw new Error(`${error.message} Download the image and upload it if the host blocks browser imports.`); }
    finally { clearTimeout(timeout); }
  });
  $("img-operation").onchange = render;
  $("img-stop").onclick = () => controller?.abort();
  async function refresh() {
    try {
      const response = await fetch("v1/images/capabilities", {headers: headers()});
      if (!response.ok) throw new Error("Enter your API key in About to check reference support.");
      ready = !!(await response.json()).reference_images;
      $("img-reference-status").textContent = ready ? "Reference images and editing are ready." : "Reference images need a vision projector configured on this server.";
    } catch (error) { ready = false; $("img-reference-status").textContent = error.message; }
    $("img-operation").querySelector('[value="edit"]').disabled = !ready;
    render();
  }
  $("api-key").addEventListener("change", refresh);
  window.StrataReferences = {
    ready: () => ready,
    refreshControls: render,
    request() { return refs.map(({data, name, role}) => ({data, name, role})); },
    begin() { running = true; controller = new AbortController(); render(); return controller.signal; },
    end() { running = false; controller = null; render(); },
    restore(value) {
      refs.length = 0; $("img-operation").value = value.operation === "edit" ? "edit" : "generate"; render();
      if (value.references?.length) imageRecipeInfo("This recipe used reference images. Upload the originals in the recorded order; the PNG stores roles and hashes, not the source files.");
    },
    useResult(data) { importing(async () => { refs.length = 0; await add(new File([StrataImage.fromBase64(data)], "generated-source.png", {type: "image/png"})); $("img-operation").value = "edit"; }); }
  };
  refresh();
})();

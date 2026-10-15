// PNG generation recipes. No pixel decoding/re-encoding, model calls, or external requests.
(() => {
  "use strict";
  const KEY = "strata.image", SCHEMA = "strata.image.v1", MAX_FILE = 20_000_000, MAX_TEXT = 65536;
  const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", {fatal: true});
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const seedOK = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  function editingSettings(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid editing controls.");
    const choices = {camera:["front","three-quarter","side","rear","high","low","overhead"], framing:["close","medium","wide","full"],
      lighting:["soft","overcast","golden","side","rim","high-key","low-key","neon"]};
    const out = {};
    for (const key of Object.keys(choices)) {
      if (value[key] === undefined || value[key] === "") continue;
      if (!choices[key].includes(value[key])) throw new Error("Invalid " + key + " preset.");
      out[key] = value[key];
    }
    if (value.region !== undefined) {
      const r = value.region;
      if (!Array.isArray(r) || r.length !== 4 || r.some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) ||
          r[2] < .01 || r[3] < .01 || r[0] + r[2] > 1.000001 || r[1] + r[3] > 1.000001) throw new Error("Invalid normalized edit region.");
      out.region = r.map(n => Math.round(n * 100000) / 100000);
    }
    return out;
  }
  function recipe(value) {
    if (!value || value.schema !== SCHEMA || typeof value.prompt !== "string" || !value.prompt.trim() ||
        value.prompt.length > 16384 || !seedOK(value.seed) || typeof value.size !== "string" || !/^\d{1,5}x\d{1,5}$/.test(value.size)) {
      throw new Error("Invalid Strata image recipe (prompt, seed or dimensions).");
    }
    const out = {schema: SCHEMA, prompt: value.prompt, seed: value.seed, size: value.size};
    if (value.editing !== undefined) out.editing = editingSettings(value.editing);
    if (["generate", "edit"].includes(value.operation)) out.operation = value.operation;
    if (value.references !== undefined) {
      if (!Array.isArray(value.references) || value.references.length > 3 || value.references.some(ref =>
        !ref || typeof ref.name !== "string" || ref.name.length > 160 || !["source", "identity", "style", "composition"].includes(ref.role) ||
        typeof ref.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(ref.sha256))) throw new Error("Invalid reference provenance in PNG recipe.");
      out.references = value.references.map(({name, role, sha256}) => ({name, role, sha256}));
    }
    for (const key of ["model", "createdAt", "originalPrompt", "templateName", "templatePrompt", "controlPrompt"]) {
      if (typeof value[key] === "string" && value[key].length <= (["originalPrompt", "templatePrompt", "controlPrompt"].includes(key) ? 16384 : 256)) out[key] = value[key];
    }
    out.settings = {};
    if (value.settings && Number.isInteger(value.settings.steps) && value.settings.steps >= 1 && value.settings.steps <= 100) out.settings.steps = value.settings.steps;
    for (const key of ["backend", "quant"]) {
      if (typeof value.settings?.[key] === "string" && value.settings[key].length <= 100) out.settings[key] = value.settings[key];
    }
    return out;
  }
  const crcTable = Array.from({length: 256}, (_, value) => {
    for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  function crc(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }
  function chunks(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_FILE || !signature.every((byte, i) => bytes[i] === byte)) throw new Error("Choose a PNG file of at most 20 MB.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = [];
    let pos = 8;
    while (pos + 12 <= bytes.length && result.length < 10000) {
      const length = view.getUint32(pos);
      if (length > bytes.length - pos - 12) throw new Error("Truncated PNG chunk.");
      const end = pos + 12 + length, type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
      if (crc(bytes.subarray(pos + 4, end - 4)) !== view.getUint32(end - 4)) throw new Error("PNG checksum mismatch.");
      if (!result.length && (type !== "IHDR" || length !== 13)) throw new Error("Invalid PNG header.");
      result.push({type, start: pos, end, data: bytes.subarray(pos + 8, end - 4)});
      pos = end;
      if (type === "IEND") {
        if (length || pos !== bytes.length) throw new Error("Invalid PNG ending.");
        return result;
      }
    }
    throw new Error("Missing PNG ending or too many chunks.");
  }
  function ownChunk(chunk) {
    return chunk.type === "iTXt" && chunk.data.length > KEY.length &&
      [...KEY].every((char, i) => chunk.data[i] === char.charCodeAt(0)) && chunk.data[KEY.length] === 0;
  }
  function read(bytes) {
    let found = null;
    for (const chunk of chunks(bytes)) {
      if (!ownChunk(chunk)) continue;
      if (found) throw new Error("PNG contains duplicate Strata recipes.");
      const data = chunk.data, offset = KEY.length + 1;
      if (data.length > MAX_TEXT || data[offset] !== 0 || data[offset + 1] !== 0 || data[offset + 2] !== 0 || data[offset + 3] !== 0) {
        throw new Error("Unsupported or oversized PNG recipe.");
      }
      found = recipe(JSON.parse(decoder.decode(data.subarray(offset + 4))));
    }
    return found;
  }
  function write(bytes, metadata) {
    const original = chunks(bytes), text = encoder.encode(JSON.stringify(recipe(metadata)));
    const prefix = encoder.encode(KEY + "\0\0\0\0\0"); // keyword, uncompressed, method 0, empty language/translation
    if (prefix.length + text.length > MAX_TEXT) throw new Error("Image recipe is too large.");
    const chunk = new Uint8Array(12 + prefix.length + text.length), view = new DataView(chunk.buffer);
    view.setUint32(0, chunk.length - 12);
    chunk.set(encoder.encode("iTXt"), 4); chunk.set(prefix, 8); chunk.set(text, 8 + prefix.length);
    view.setUint32(chunk.length - 4, crc(chunk.subarray(4, chunk.length - 4)));
    const parts = [signature];
    for (const item of original) {
      if (ownChunk(item)) continue;
      if (item.type === "IEND") parts.push(chunk);
      parts.push(bytes.subarray(item.start, item.end));
    }
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    if (output.length > MAX_FILE) throw new Error("Annotated PNG exceeds 20 MB.");
    let pos = 0;
    for (const part of parts) { output.set(part, pos); pos += part.length; }
    return output;
  }
  function fromBase64(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  function toBase64(bytes) {
    let text = "";
    for (let pos = 0; pos < bytes.length; pos += 32768) text += String.fromCharCode(...bytes.subarray(pos, pos + 32768));
    return btoa(text);
  }
  const noText = "No text, letters, words, numbers, captions, labels, signatures, logos or watermarks anywhere in the image.";
  const starters = [
    ["marvel", "Marvel-style comic", "Genre", "Marvel-style superhero comic illustration of {subject}. Dynamic foreshortening, energetic action, expressive character acting, bold ink contours, vibrant colors, dramatic rim light, detailed cinematic composition. Single illustration, no speech bubbles. " + noText],
    ["dc", "DC-style comic", "Genre", "DC-style superhero comic illustration of {subject}. Monumental heroic composition, powerful silhouette, sculpted anatomy, deep shadows, crisp ink, rich restrained color, dramatic atmospheric city lighting. Single illustration, no speech bubbles. " + noText],
    ["pixar", "Pixar-style animation", "Genre", "Pixar-style cinematic 3D animation still of {subject}. Appealing expressive character design, polished stylized materials, soft global illumination, rich color harmony, warm visual storytelling, detailed environment. " + noText],
    ["live", "Live action / cinematic", "Genre", "Live-action cinematic photograph of {subject}. Believable proportions and materials, natural skin and surface texture, motivated lighting, carefully framed storytelling, subtle film grain, lifelike detail. " + noText],
    ["fashion", "Fashion editorial", "Genre", "High-fashion editorial photograph of {subject}. Distinctive styling, considered wardrobe silhouettes and fabric texture, confident posing, elegant composition, professional editorial lighting, realistic materials. " + noText],
    ["location", "Location / establishing shot", "Genre", "Establishing image of {subject}. Clear geography and architectural identity, strong foreground/middle/background depth, coherent scale, believable lighting and atmosphere, rich environmental detail, cinematic composition. " + noText],
    ["prop", "Prop / product concept", "Genre", "Detailed prop concept of {subject}. Clear readable silhouette, consistent functional construction, intentional materials, realistic surface finish, studio lighting, neutral uncluttered background. " + noText],
    ["fantasy", "Fantasy concept art", "Genre", "Fantasy concept art of {subject}. Imaginative coherent world design, expressive shapes, crafted materials, atmospheric lighting, cinematic depth, clear visual hierarchy, polished painterly detail. " + noText],
    ["scifi", "Science-fiction concept art", "Genre", "Science-fiction concept art of {subject}. Coherent engineered forms, readable silhouette, believable material transitions, functional detailing, controlled cinematic lighting and strong environmental storytelling. " + noText],
    ["anime", "Anime / manga illustration", "Genre", "Anime and manga-inspired illustration of {subject}. Expressive character acting, clean confident linework, carefully grouped cel shading, striking composition, detailed but readable setting, coherent lighting and color. Single illustration with no speech bubbles. " + noText],
    ["watercolor", "Watercolor illustration", "Genre", "Traditional watercolor illustration of {subject}. Transparent layered washes, natural pigment blooms and granulation, subtle textured paper, delicate edges, restrained confident brushwork and thoughtful negative space. " + noText],
    ["interior", "Architectural interior", "Genre", "Architectural interior visualization of {subject}. Coherent room geometry, plausible circulation and furniture scale, considered material palette, natural window light, realistic surface finishes, carefully framed professional architectural photography. " + noText],
    ["food", "Food photography", "Genre", "Professional food photograph of {subject}. Appetizing natural textures, intentional plating and prop styling, plausible fresh ingredients, soft directional light, restrained background, coherent highlights and shallow depth of field. " + noText],
    ["product", "Product photography", "Genre", "Premium commercial product photograph of {subject}. Accurate coherent construction, crisp controlled silhouette, realistic surface texture, elegant studio lighting and reflections, simple uncluttered background, generous negative space. " + noText],
    ["texture", "Seamless texture starter", "Genre", "A flat, evenly lit, top-down seamless repeating material texture of {subject}. Consistent real-world scale and surface detail across the image, no perspective, no isolated central object, no directional cast shadows, matching opposite edges with no visible seam. " + noText],
    ["character-sheet", "Character turnaround — no text", "Sheets", "A clean character turnaround sheet of {subject}. Four evenly spaced full-body views: front, three-quarter, side and back. Exactly the same character identity, face, costume, body proportions, colors and accessories in each view, same scale and ground line, neutral pose, plain light background, clear separation between views. " + noText],
    ["expression-sheet", "Character expressions — no text", "Sheets", "A character expression sheet of {subject}. Six evenly spaced head-and-shoulder views of exactly the same character: neutral, joyful, angry, worried, surprised and thoughtful. Consistent identity, hairstyle, costume and lighting, plain light background, clear separation between portraits. " + noText],
    ["prop-sheet", "Prop views — no text", "Sheets", "A prop reference sheet of {subject}. Front, side, back, top and three-quarter views of exactly the same object. Consistent design, dimensions, colors, functional construction and materials in all views, neutral studio lighting, plain light background, neatly spaced isolated views, no dimension lines. " + noText],
    ["environment-sheet", "Environment views — no text", "Sheets", "An environment reference sheet of {subject}. One wide establishing view and three supporting views of the same location from different angles, including close architectural and material details. Consistent geography, architecture, scale, weather, time of day and lighting, clean separate panels. " + noText],
    ["costume-sheet", "Costume exploration — no text", "Sheets", "A costume exploration sheet for {subject}. Four evenly spaced full-body versions of exactly the same character and neutral pose, each wearing a distinct coherent costume variation. Consistent identity, face, body proportions, scale and lighting; show readable fabric layers, closures and accessories on a plain light background. " + noText],
    ["material-sheet", "Material variations — no text", "Sheets", "A material exploration sheet of {subject}. Six neatly separated versions of exactly the same prop, at identical scale and three-quarter angle, rendered respectively in wood, metal, glass, fabric, ceramic and stone. Identical geometry and studio lighting, believable material-specific surface detail, plain neutral background. " + noText],
    ["vehicle-sheet", "Vehicle views — no text", "Sheets", "A vehicle reference sheet of {subject}. Front, side, rear, top and three-quarter views of the same vehicle, consistent body geometry, wheel positions, proportions, scale, colors and materials. Clean isolated views, neutral studio lighting, plain light background, no measurement lines. " + noText],
    ["storyboard", "Storyboard sequence — no text", "Sheets", "A six-panel visual storyboard of {subject}. Tell one coherent sequence through distinct cinematic shots, clear action and readable staging. Keep character identity, costume, props, location and lighting consistent across panels; use clear gutters, intentional camera angles and restrained grayscale shading. No panel numbering or speech balloons. " + noText],
    ["icons", "Matching icon set — no text", "Sheets", "A coherent set of twelve distinct icons representing {subject}. Consistent stroke weight, corner shapes, visual scale, limited color palette, simple readable silhouettes, generous uniform spacing on a plain light background. No badges with lettering. " + noText],
  ].map(([id, name, group, prompt]) => ({id, name, group, prompt, size: group === "Sheets" ? "1536x1024" : "1024x1024"}));
  function prepareTemplate(item, subject, operation, references) {
    const edit = operation === "edit";
    const identity = references.findIndex(ref => ["source", "identity"].includes(ref.role));
    const inferred = identity >= 0 ? "the subject" : "a new scene";
    const base = typeof item.templatePrompt === "string" ? item.templatePrompt : item.prompt;
    let prompt = item.group ? base.replace("{subject}", () => edit ? "the subject" : subject || inferred) : base;
    if (edit && item.group && subject) prompt = `Requested changes: ${subject}\n\n${prompt}`;
    const lines = [];
    if (edit) {
      lines.push("Edit image 1 (the source image). Apply the requested changes and template treatment below. Preserve the main subject's identity, recognizable features and design. Keep the source framing and composition unless requested changes, composition guidance or sheet layout require otherwise.");
    } else if (references.length) {
      lines.push("Generate a new image using the references below. Create a new scene; do not assume image 1 must be edited in place.");
    } else if (item.operation === "edit") {
      lines.push("Generate a new image using the template description below. This is a new scene, not an edit of an existing source image.");
    }
    const guidance = {
      source: "Use its subject or object design as a reference; adapt the pose, setting and layout to the requested scene.",
      identity: "Preserve the referenced subject's identity and recognizable features; do not copy its background unless requested.",
      style: "Use its visual style, materials, lighting and palette as guidance; do not copy its subject's identity unless requested.",
      composition: "Use its framing, layout and spatial arrangement as guidance; do not copy its subject's identity unless requested."
    };
    references.forEach((ref, index) => lines.push(edit && index === 0 ? "Image 1 — source: the image to modify." :
      `Image ${index + 1} — ${ref.role}: ${guidance[ref.role] || guidance.identity}`));
    if (references.length) lines.push("Use each reference only for its assigned role. The requested changes take precedence if reference guidance conflicts.");
    const prefix = lines.length ? lines.join("\n") + "\n\nTemplate treatment:\n" : "";
    return {prompt: prefix + prompt, prefix, basePrompt: prompt};
  }
  globalThis.StrataImage = {SCHEMA, MAX_FILE, recipe, read, write, fromBase64, toBase64, starters, prepareTemplate, editingSettings};
})();

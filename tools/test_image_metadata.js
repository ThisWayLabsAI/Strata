// node --test tools/test_image_metadata.js (no browser, dependencies or GPU)
const test = require("node:test");
const assert = require("node:assert/strict");
require("../serve/web/image-tools.js");
const api = globalThis.StrataImage;
const png = api.fromBase64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==");
const metadata = {schema: api.SCHEMA, prompt: "A cat 🐈, café, 猫", seed: 0, size: "1024x1024", model: "qwen-image-2.1-turbo",
  createdAt: "2026-10-15T18:00:00.000Z", settings: {steps: 8, backend: "cuda", quant: "Q8_0"}};
function chunks(data) {
  const bytes = Buffer.from(data), result = [];
  for (let pos = 8; pos < bytes.length;) {
    const length = bytes.readUInt32BE(pos), end = pos + length + 12;
    result.push({type: bytes.toString("ascii", pos + 4, pos + 8), bytes: bytes.subarray(pos, end)}); pos = end;
  }
  return result;
}
test("UTF-8 prompt, actual zero seed, model and settings round-trip", () => {
  assert.deepEqual(api.read(api.write(png, metadata)), metadata);
});
test("Original pixel chunks and all original PNG bytes are preserved", () => {
  const out = api.write(png, metadata);
  assert.deepEqual(chunks(out).filter((chunk) => chunk.type !== "iTXt"), chunks(png));
  assert.deepEqual(out.subarray(0, 8), png.subarray(0, 8));
});
test("Existing generator parameters and other ancillary metadata are preserved", () => {
  const data = Buffer.from("parameters\0An existing prompt\nSeed: 42", "utf8"), chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length); chunk.write("tEXt", 4); data.copy(chunk, 8);
  let checksum = 0xffffffff;
  for (const byte of chunk.subarray(4, chunk.length - 4)) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++) checksum = checksum & 1 ? 0xedb88320 ^ (checksum >>> 1) : checksum >>> 1;
  }
  chunk.writeUInt32BE((checksum ^ 0xffffffff) >>> 0, chunk.length - 4);
  const original = Buffer.concat([Buffer.from(png.subarray(0, png.length - 12)), chunk, Buffer.from(png.subarray(png.length - 12))]);
  const out = api.write(original, metadata);
  assert.deepEqual(chunks(out).filter((part) => part.type !== "iTXt"), chunks(original));
  assert.deepEqual(api.read(out), metadata);
});
test("Rewriting replaces recipe rather than accumulating old seeds", () => {
  const out = api.write(api.write(png, metadata), {...metadata, seed: 123});
  assert.equal(chunks(out).filter((chunk) => chunk.type === "iTXt").length, 1);
  assert.equal(api.read(out).seed, 123);
});
test("Ordinary PNG has no recipe; malformed and non-PNG files fail", () => {
  assert.equal(api.read(png), null);
  assert.throws(() => api.read(new Uint8Array([1, 2, 3])));
  assert.throws(() => api.read(png.subarray(0, png.length - 2)));
  const corrupt = png.slice(); corrupt[45] ^= 1;
  assert.throws(() => api.read(corrupt), /checksum/);
});
test("Duplicated recipes are refused", () => {
  const out = api.write(png, metadata), parts = chunks(out), duplicate = parts.find((chunk) => chunk.type === "iTXt").bytes;
  const merged = Buffer.concat([Buffer.from(out.subarray(0, out.length - 12)), duplicate, Buffer.from(out.subarray(out.length - 12))]);
  assert.throws(() => api.read(merged), /duplicate/);
});
test("Embedded recipe bytes are checksummed and bounded", () => {
  const out = api.write(png, metadata), parts = chunks(out), recipe = parts.find((chunk) => chunk.type === "iTXt");
  const offset = parts.slice(0, parts.indexOf(recipe)).reduce((sum, chunk) => sum + chunk.bytes.length, 8);
  out[offset + 25] ^= 1;
  assert.throws(() => api.read(out), /checksum/);
  assert.throws(() => api.read(new Uint8Array(api.MAX_FILE + 1)), /20 MB/);
});
test("Unsafe seeds, oversized prompts and schema mismatch are rejected", () => {
  for (const seed of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "12", null]) assert.throws(() => api.write(png, {...metadata, seed}));
  assert.throws(() => api.write(png, {...metadata, prompt: "a".repeat(16385)}));
  assert.throws(() => api.write(png, {...metadata, schema: "unknown"}));
  assert.equal(api.read(api.write(png, {...metadata, seed: Number.MAX_SAFE_INTEGER})).seed, Number.MAX_SAFE_INTEGER);
});
test("Unknown fields including private paths and URLs are not imported", () => {
  const out = api.read(api.write(png, {...metadata, api_key: "not-a-real-key", exe: "private", reference_url: "https://example.invalid",
    settings: {...metadata.settings, exe: "private", steps: 101}}));
  assert.equal(out.api_key, undefined); assert.equal(out.reference_url, undefined); assert.equal(out.exe, undefined);
  assert.deepEqual(out.settings, {backend: "cuda", quant: "Q8_0"});
});
test("Parser accepts typed arrays at nonzero buffer offset and base64 round-trip", () => {
  const out = api.write(png, metadata), padded = new Uint8Array(out.length + 9); padded.set(out, 5);
  assert.deepEqual(api.read(padded.subarray(5, out.length + 5)), metadata);
  assert.deepEqual(api.fromBase64(api.toBase64(out)), out);
});
test("Genre starters and text-free character/prop/environment sheets are present", () => {
  assert.equal(new Set(api.starters.map((item) => item.id)).size, api.starters.length);
  for (const id of ["marvel", "dc", "pixar", "live", "fashion", "location", "prop", "character-sheet", "prop-sheet", "environment-sheet"]) {
    const item = api.starters.find((entry) => entry.id === id); assert.ok(item); assert.ok(item.prompt.includes("{subject}"));
  }
  for (const item of api.starters.filter((entry) => entry.group === "Sheets")) assert.match(item.prompt, /No text, letters/);
});

test("Edit provenance round-trips without embedding references or source URLs", () => {
  const reference = {name: "source.png", role: "source", sha256: "a".repeat(64)};
  const out = api.read(api.write(png, {...metadata, operation: "edit", references: [{...reference, data: "private", url: "https://private.invalid"}]}));
  assert.equal(out.operation, "edit"); assert.deepEqual(out.references, [reference]);
  for (const references of [[{...reference, sha256: "bad"}], [{...reference, role: "bad"}], Array(4).fill(reference), "bad"]) {
    assert.throws(() => api.recipe({...metadata, references}), /reference provenance/);
  }
});

test("Every starter keeps the original Generate prompt without references", () => {
  for (const item of api.starters) {
    const result = api.prepareTemplate(item, "a café cat with $&", "generate", []);
    assert.equal(result.prompt, item.prompt.replace("{subject}", () => "a café cat with $&"));
    assert.equal(result.prefix, "");
  }
});
test("Every Edit starter preserves source identity, requested changes and text-free treatment", () => {
  for (const item of api.starters) {
    const result = api.prepareTemplate(item, "turn the background blue", "edit", [{role:"source"}]);
    assert.match(result.prompt, /Edit image 1/);
    assert.match(result.prompt, /Preserve the main subject's identity/);
    assert.match(result.basePrompt, /Requested changes: turn the background blue/);
    assert.match(result.basePrompt, /the subject/);
    assert.doesNotMatch(result.basePrompt, /image [123]/);
    assert.match(result.prompt, /No text, letters/);
    assert.equal(result.prompt, result.prefix + result.basePrompt);
  }
});
test("Reference roles and numbers follow current order, without leaking names or bytes", () => {
  const item = api.starters[0], references = [{role:"style",name:"private",data:"secret"}, {role:"identity"}, {role:"composition"}];
  const result = api.prepareTemplate(item, "", "generate", references);
  assert.match(result.prompt, /Generate a new image/);
  assert.match(result.prompt, /Image 1 — style/);
  assert.match(result.prompt, /Image 2 — identity/);
  assert.match(result.prompt, /Image 3 — composition/);
  assert.match(result.basePrompt, /the subject/);
  assert.doesNotMatch(result.basePrompt, /image [123]/);
  assert.doesNotMatch(result.prompt, /private|secret|Edit image 1/);
  assert.match(api.prepareTemplate(item, "", "generate", [{role:"style"}]).basePrompt, /a new scene/);
});
test("Saved templates and PNG base prompts adapt without accumulating generated context", () => {
  const custom = {prompt:"Keep my custom design.", operation:"edit"};
  const first = api.prepareTemplate(custom, "", "edit", [{role:"source"}]);
  const recovered = api.read(api.write(png, {...metadata, prompt:first.prompt, templatePrompt:first.basePrompt}));
  const reused = api.prepareTemplate({...recovered, operation:"edit"}, "", "generate", []);
  assert.equal(reused.basePrompt, custom.prompt);
  assert.match(reused.prompt, /Generate a new image/);
  assert.doesNotMatch(reused.prompt, /Edit image 1/);
});

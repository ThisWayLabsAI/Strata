// Isolated no-GPU fixture only. Replaces fixture references and chat drafts.
(async () => {
  if (health.model !== "mobile-fixture-no-gpu") throw new Error("Use the isolated fixture");
  const checks = [], check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  const until = async fn => { for (let i = 0; i < 150; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error("Timed out"); };
  const nativeFetch = window.fetch; let submissions = 0;
  window.fetch = (url, options) => { if (options?.method === "POST") submissions++; return nativeFetch(url, options); };
  const png = StrataImage.fromBase64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==");
  const recipe = {schema: StrataImage.SCHEMA, prompt: "A red toy robot", seed: 0, size: "512x512"};
  const bytes = StrataImage.write(png, recipe);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join("");
  const upload = async file => {
    const input = $("img-reference-original-files"), transfer = new DataTransfer(); transfer.items.add(file);
    input.files = transfer.files; input.dispatchEvent(new Event("change"));
    await until(() => !$("img-operation").disabled);
  };
  const close = () => $("upload-info-dialog").close();
  try {
    await until(() => StrataReferences.ready()); showTab("images");
    StrataReferences.restore({operation: "generate"});
    await upload(new File([bytes], "1000063957", {type: "application/octet-stream"}));
    const list = $("img-reference-list"), card = list.firstElementChild;
    check(list.children.length === 1 && card.textContent.includes("Strata recipe found"), "Numeric filename and generic MIME still detect the PNG recipe in Images");
    check(StrataReferences.request()[0].data === "data:image/png;base64," + StrataImage.toBase64(bytes), "Reference data preserves every original byte and uses actual PNG format");
    const load = [...card.querySelectorAll("button")].find(b => b.textContent === "Load recipe");
    check(!!load, "Original-file import exposes Load recipe");
    [...card.querySelectorAll("button")].find(b => b.textContent === "File details").click();
    const info = JSON.parse($("upload-info-data").textContent);
    check($("upload-info-dialog").open && $("upload-info-status").textContent.includes("seed 0"), "File details confirms recipe with actual zero seed");
    check(info.format === "image/png" && info.reportedFormat === "application/octet-stream" && info.bytes === bytes.length, "Details distinguish actual format, provider MIME and exact size");
    check(info.sha256 === hash, "Details identify the received original bytes by SHA-256");
    check($("upload-info-dialog").getBoundingClientRect().width <= innerWidth, "File details dialog fits the viewport");
    close(); load.click();
    check($("img-prompt").value === recipe.prompt && $("img-seed").value === "0" && StrataReferences.request().length === 1, "Loading the recognized recipe preserves the selected source");
    check(!JSON.stringify(StrataReferences.request()).includes("uploadInfo"), "Local upload diagnostics do not enter image API references");
    StrataReferences.restore({operation: "generate"});
    await upload(new File([png], "1000063957.png", {type: "image/png"}));
    check(list.textContent.includes("No Strata recipe found") && ![...list.querySelectorAll("button")].some(b => b.textContent === "Load recipe"), "A metadata-free copy is clearly distinguished from a recognized recipe");
    [...list.querySelectorAll("button")].find(b => b.textContent === "File details").click();
    check(JSON.parse($("upload-info-data").textContent).sha256 !== hash, "Changed received bytes produce a different diagnostic hash"); close();
    showTab("chat"); attachments = [];
    const input = $("chat-image-original-file"), transfer = new DataTransfer(); transfer.items.add(new File([bytes], "1000063957", {type: ""}));
    input.files = transfer.files; input.dispatchEvent(new Event("change"));
    await until(() => !attachmentReads && attachments.length === 2);
    check(attachments.some(a => a.imageRecipe && a.text.includes('"seed": 0')), "Chat original-file picker extracts recipe despite absent MIME and extension");
    $("attachments").querySelector(".upload-info-name").click();
    check(JSON.parse($("upload-info-data").textContent).sha256 === hash, "Tapping the chat image filename opens the same received-file diagnostics"); close();
    check(!submissions, "Inspection, file selection and recipe loading never submit inference");
    check(document.documentElement.scrollWidth <= innerWidth + 1, "Upload controls do not widen the page");
    attachments = []; renderAttachments();
  } finally { window.fetch = nativeFetch; if ($("upload-info-dialog").open) close(); }
  return {passed: checks.length, checks};
})();

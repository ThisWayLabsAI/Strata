// Run only against tools/model_switch_fixture.py (port 8092), never live history.
(async () => {
  if (location.port !== "8092") throw new Error("Use the isolated model-switch fixture");
  const checks = [];
  const check = (ok, text) => { if (!ok) throw new Error(text); checks.push(text); };
  const waitFor = async predicate => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error("Fixture did not settle");
  };
  await loadChatModels();
  check(!$("chat-model-row").hidden, "Opt-in registry exposes selector");
  if (document.documentElement.dataset.chatCompact === "true") $("chat-model-settings").click();
  check(document.documentElement.dataset.chatCompact !== "true" || $("chat-model-settings").getBoundingClientRect().height >= 44, "Compact model settings has a touch-sized control");
  const select = value => { $("chat-model").value = value; $("chat-model").dispatchEvent(new Event("change")); };
  select("sc117");
  await loadChatModels();
  check(conversationModel === "sc117", "Selection belongs to conversation");
  check(store.get("chatModel") === "sc117", "Selection saved for refresh");
  const before = await (await fetch("v1/model-selection")).json();
  check(before.active_model === modelSelection.active_model, "Selection alone does not run inference");
  $("input").value = "hello";
  $("chat-image-row").hidden = false;
  const sent = send();
  check($("chat-model").disabled, "Selector disabled while sending");
  const stopBox = $("stop-btn").getBoundingClientRect();
  check(stopBox.top >= 0 && stopBox.bottom <= innerHeight, "Stop fits with model selection and image opt-in during streaming");
  await sent;
  await loadChatModels();
  await waitFor(() => modelSelection.active_model === "sc117");
  check(messages.at(-1).model === "sc117", "Response stores actual serving model");
  check(modelSelection.active_model === "sc117", "Send switches active model");
  check(!$("chat-model").disabled, "Selector enabled after completion");
  check($("chat-model-status").textContent.includes("Active: sc117"), "Active status visible");
  const savedFetch = window.fetch;
  let attempts = 0;
  window.fetch = async (...args) => {
    if (String(args[0]) === "v1/chat/completions") {
      attempts++;
      return new Response(JSON.stringify({error:{code:"model_busy", message:"Another request is active; retry manually."}}), {status:409});
    }
    return savedFetch(...args);
  };
  try {
    $("input").value = "busy refusal";
    await send();
    check(attempts === 1 && messages.at(-1).error.includes("retry manually"), "Busy error is visible without automatic replay");
    check(conversationModel === "sc117", "Busy refusal preserves requested model");
  } finally { window.fetch = savedFetch; }
  $("input").value = "manual retry";
  await send();
  $("new-btn").click();
  await loadChatModels();
  check($("chat-model").value === "original", "New chat uses startup default");
  check(!messages.length, "New chat clears transcript");
  [...document.querySelectorAll("#toasts button")].at(-1).click();
  await loadChatModels();
  check(conversationModel === "sc117" && messages.at(-1).model === "sc117", "Undo restores transcript and selection together");
  await fetch("v1/model-selection", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({model:"original"})});
  await loadChatModels();
  check($("chat-model").value === "sc117", "External switch leaves conversation selection intact");
  check($("chat-model-status").textContent.includes("Requested: sc117. Active: original"), "Requested and active are distinct");
  const originalFetch = window.fetch;
  window.fetch = async (...args) => String(args[0]) === "v1/models" ? new Response(JSON.stringify({data:[{id:"original", switchable:true, meta:{n_ctx:8192}}]})) : originalFetch(...args);
  try {
    await loadChatModels();
    check($("chat-model").value === "sc117" && $("chat-model").selectedOptions[0].text.includes("unavailable"), "Stale selection remains visible without substitution");
  } finally { window.fetch = originalFetch; }
  await loadChatModels();
  if (document.documentElement.dataset.chatCompact === "true" && $("chat-model-settings").getAttribute("aria-expanded") !== "true") $("chat-model-settings").click();
  const box = $("chat-model").getBoundingClientRect();
  check(box.left >= 0 && box.right <= innerWidth && box.height >= 44, "Selector fits viewport with touch-sized height");
  check(document.documentElement.scrollWidth <= innerWidth, "No page-wide horizontal overflow");
  const name = $("chat-model").selectedOptions[0];
  const oldName = name.textContent, oldStatus = $("chat-model-status").textContent;
  name.textContent = "qwen3.8-flash-next-sc117-abliterated-iq2_xs · 128K";
  $("chat-model-status").textContent = "Requested: qwen3.8-flash-next-sc117-abliterated-iq2_xs. Active: qwen3.8-flash-next-iq2_xs (loaded). Selection applies on Send.";
  check(document.documentElement.scrollWidth <= innerWidth, "Installed model IDs fit viewport");
  const sendBox = $("send-btn").getBoundingClientRect();
  check(sendBox.bottom <= innerHeight && sendBox.top >= 0, "Send remains visible with full installed IDs");
  $("chat-image-row").hidden = false;
  const combined = $("send-btn").getBoundingClientRect();
  check(combined.bottom <= innerHeight && combined.top >= 0, "Send fits with model settings and image opt-in together");
  name.textContent = oldName; $("chat-model-status").textContent = oldStatus;
  const optionNode = $("chat-model").options[0];
  await loadChatModels();
  check($("chat-model").options[0] === optionNode, "Status polling preserves selector option nodes");
  const raceFetch = window.fetch;
  let releaseOld, firstStatus = true;
  window.fetch = (...args) => {
    if (String(args[0]) === "v1/model-selection" && firstStatus) {
      firstStatus = false;
      return new Promise(resolve => { releaseOld = resolve; });
    }
    return raceFetch(...args);
  };
  try {
    const stale = loadChatModels();
    await loadChatModels();
    releaseOld(new Response(JSON.stringify({...modelSelection, active_model:"stale-response"})));
    await stale;
    check(modelSelection.active_model !== "stale-response", "Older status response cannot overwrite newer identity");
  } finally { window.fetch = raceFetch; }
  saveChat();
  return {viewport:[innerWidth, innerHeight], checks:checks.length, names:checks};
})();

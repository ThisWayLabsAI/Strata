// CPU fixture only; never run against user history or a GPU server.
(async()=>{
  if(location.port!=="8091"||health.model!=="mobile-fixture-no-gpu")throw Error("Use CPU fixture 8091");
  await document.fonts.ready;
  const checks=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const wait=()=>new Promise(r=>setTimeout(r,100));
  const visible=e=>!!e.getBoundingClientRect().width&&!!e.getBoundingClientRect().height;
  chatLayout="mobile";applyChatLayout();setComposerCollapsed(false);await wait();
  const toggle=$("chat-image-toggle"),checkbox=$("chat-image-enabled");
  checkbox.checked=false;checkbox.dispatchEvent(new Event("change"));
  check(visible(toggle)&&toggle.getAttribute("aria-label")==="Create images in chat","Image toggle is visible and named on supported mobile servers");
  for(const theme of ["dark","light"]){
    document.documentElement.dataset.theme=theme;
    await wait();
    const off=getComputedStyle(toggle).backgroundColor;
    check(toggle.getAttribute("aria-pressed")==="false"&&!visible(toggle.querySelector(".chat-image-toggle-check")),theme+" off state has no checkmark");
    toggle.click();await wait();
    check(checkbox.checked&&toggle.getAttribute("aria-pressed")==="true"&&toggle.title.endsWith("on"),theme+" toolbar toggle enables the existing image opt-in");
    check(getComputedStyle(toggle).backgroundColor!==off&&visible(toggle.querySelector(".chat-image-toggle-check")),theme+" on state has accent styling and a checkmark");
    check(store.get("chatImageTools")===true,"Existing image preference is saved");
    setComposerCollapsed(true);setComposerCollapsed(false);
    check(toggle.getAttribute("aria-pressed")==="true","Collapsing retains image mode");
    toggle.click();
    check(!checkbox.checked&&toggle.getAttribute("aria-pressed")==="false",theme+" toolbar toggle disables image mode");
  }
  checkbox.checked=true;checkbox.dispatchEvent(new Event("change"));
  check(toggle.getAttribute("aria-pressed")==="true","Options checkbox synchronizes the toolbar");
  checkbox.checked=false;checkbox.dispatchEvent(new Event("change"));
  const canvas=document.createElement("canvas");canvas.width=canvas.height=1;
  selectChatReference(canvas.toDataURL(),"fixture-reference.png");
  check(toggle.getAttribute("aria-pressed")==="true"&&!$("chat-image-inputs").hidden,"Selecting a reference synchronizes the toggle and opens image settings in Options");
  chatReferences.length=0;renderChatReferences();closeChatOptions();
  const bodies=[],originalFetch=window.fetch;
  window.fetch=(url,init)=>{if(String(url).includes("/chat/completions"))bodies.push(JSON.parse(init.body));return originalFetch(url,init);};
  try{
    $("input").value="hello";const pending=send();await wait();
    check(toggle.disabled,"Image toggle is disabled during generation");
    await pending;setComposerCollapsed(false);
    toggle.click();$("input").value="hello again";await send();setComposerCollapsed(false);
  }finally{window.fetch=originalFetch;}
  check(bodies.length===2&&bodies[0].strata_images===true&&!bodies[1].strata_images,"Only enabled image mode adds strata_images to requests");
  const supported=health.chat_image_generation;health.chat_image_generation=false;renderChatReferences();
  check(!visible(toggle),"Unsupported servers hide the image toggle");health.chat_image_generation=supported;renderChatReferences();
  $("composer-options-toggle").click();await wait();
  check(!visible($("sampling-btn"))&&visible($("chat-options-sampling")),"Sampling stays available in mobile Options without taking toolbar space");
  $("chat-options-sampling").click();
  check($("drawer").dataset.open==="true"&&$("chat-options").dataset.open==="false","Options sampling action opens the existing drawer and dismisses Options");openDrawer(false);
  chatLayout="desktop";applyChatLayout();await wait();
  check(!visible(toggle)&&visible($("sampling-btn")),"Desktop retains its checkbox and sampling gear");
  chatLayout="mobile";applyChatLayout();setComposerCollapsed(false);
  return {viewport:[innerWidth,innerHeight],passed:checks.length,checks};
})();

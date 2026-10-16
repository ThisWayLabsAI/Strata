// Isolated CPU fixture only, with real hit testing for the response backdrop.
(async()=>{
  if(location.port!=="8091"||health.model!=="mobile-fixture-no-gpu")throw Error("Use CPU fixture 8091");
  await document.fonts.ready;
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  $("toasts").replaceChildren(); // Earlier fixture suites deliberately create error notifications.
  const checks=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const wait=()=>new Promise(r=>setTimeout(r,100));
  const visible=e=>!!e.getBoundingClientRect().width&&!!e.getBoundingClientRect().height;
  const open=()=>{if($("chat-options").dataset.open!=="true")$("composer-options-toggle").click();};
  chatLayout="mobile";applyChatLayout();setComposerCollapsed(false);$("input").value="Options surface draft";
  for(const theme of ["dark","light"]){
    setTheme(theme,false);open();await wait();
    const panel=$("chat-options"),backdrop=$("chat-options-backdrop"),button=$("composer-options-toggle");
    check(visible($("chat-options-heading"))&&$("chat-options-title").textContent==="Chat options",theme+": panel has a visible heading");
    check($("chat-options-close").getBoundingClientRect().height>=44,theme+": explicit close is touch-sized");
    check(getComputedStyle(panel).backgroundColor!==getComputedStyle(document.body).backgroundColor&&getComputedStyle(panel).boxShadow!=="none",theme+": raised panel surface and shadow differ from response background");
    check(visible(backdrop)&&getComputedStyle(backdrop).backgroundColor!=="rgba(0, 0, 0, 0)",theme+": response backdrop appears only with Options");
    check(button.getAttribute("aria-expanded")==="true"&&getComputedStyle(button).color===getComputedStyle(button).borderTopColor,theme+": active Options button has the accent treatment");
    const bounds=panel.getBoundingClientRect(),view=$("view-chat").getBoundingClientRect();
    check(bounds.left>=0&&bounds.right<=innerWidth&&bounds.top>=0&&bounds.bottom<=innerHeight,theme+": panel fits the viewport");
    check(document.elementFromPoint(bounds.left+8,bounds.top+8)?.closest("#chat-options"),theme+": panel receives taps above backdrop");
    const sender=$("send-btn").getBoundingClientRect();
    check(document.elementFromPoint(sender.left+sender.width/2,sender.top+sender.height/2)?.closest("#send-btn"),theme+": backdrop does not block composer actions");
    if(bounds.top>view.top+4)check(document.elementFromPoint(20,view.top+2)===backdrop,theme+": exposed response area receives outside taps on backdrop");
    $("chat-options-close").click();
    check(!visible(backdrop)&&button.getAttribute("aria-expanded")==="false"&&document.activeElement===button,theme+": close hides backdrop and returns focus");
    open();backdrop.click();check(!visible(backdrop)&&panel.dataset.open==="false",theme+": outside tap closes Options");
    open();document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}));
    check(panel.dataset.open==="false"&&$("input").value==="Options surface draft",theme+": Escape closes without clearing the draft");
    open();setComposerCollapsed(true);
    check(!visible(backdrop),theme+": collapsing composer removes dimming");
    setComposerCollapsed(false);
  }
  open();chatLayout="desktop";applyChatLayout();await wait();
  check(!visible($("chat-options-backdrop"))&&!visible($("chat-options-heading")),"Desktop retains inline controls without a modal-looking layer");
  chatLayout="auto";applyChatLayout();closeChatOptions();
  return {viewport:[innerWidth,innerHeight],passed:checks.length,checks};
})();

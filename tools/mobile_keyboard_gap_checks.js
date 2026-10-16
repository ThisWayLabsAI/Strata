// CPU fixture only. Simulate viewport metrics and a retained browser bottom inset.
(async()=>{
  if(location.port!=="8091"||health.model!=="mobile-fixture-no-gpu")throw Error("Use CPU fixture 8091");
  await document.fonts.ready;
  const checks=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const vv=visualViewport,root=document.documentElement;
  const original=new Map(["height","offsetTop","scale"].map(key=>[key,Object.getOwnPropertyDescriptor(vv,key)]));
  const set=(key,value)=>Object.defineProperty(vv,key,{configurable:true,value});
  const full=innerHeight,keyboard=Math.max(200,full-280);
  if(full-keyboard<=120)throw Error("Run this metric suite at a normal pre-keyboard height >320px");
  try{
    chatLayout="mobile";applyChatLayout();setComposerCollapsed(false);
    $("input").blur();set("scale",1);set("height",full);set("offsetTop",0);fitChatViewport();
    root.style.setProperty("--chat-bottom-safe-area","88px");
    check(getComputedStyle(document.querySelector(".composer-wrap")).paddingBottom==="88px","Normal layout retains the browser bottom safe area");
    check(document.querySelector('meta[name="viewport"]').content.includes("interactive-widget=resizes-content"),"Mobile requests keyboard resizing of page content");
    $("input").focus();set("height",keyboard);set("offsetTop",12);vv.dispatchEvent(new Event("resize"));await wait(350);
    check(root.dataset.chatKeyboard==="true","Focused viewport reduction identifies an open keyboard");
    const gap=12+keyboard-$("composer").getBoundingClientRect().bottom;
    check(Math.abs(gap-8)<1,"Composer is 8px above the simulated keyboard edge despite an 88px retained inset");
    check(Math.abs(document.body.getBoundingClientRect().height-keyboard)<1,"Body fits the visible keyboard viewport without another height subtraction");
    const transcript=messages;
    messages=[{role:"assistant",text:"Older reading position. ".repeat(3000),time:Date.now()}];renderChat();await wait(100);
    $("chat-scroll").scrollTop=250;await wait(100);
    const readingAt=$("chat-scroll").scrollTop;settleChatViewport();await wait(350);
    check(!followLatest&&Math.abs($("chat-scroll").scrollTop-readingAt)<2,"Unchanged settling measurements preserve an older reading position");
    messages=transcript;renderChat();
    const before=document.body.getBoundingClientRect().height;
    set("scale",2);set("height",150);vv.dispatchEvent(new Event("resize"));await wait(350);
    check(document.body.getBoundingClientRect().height===before,"Pinch zoom does not change keyboard layout height");
    set("scale",1);set("height",keyboard);vv.dispatchEvent(new Event("resize"));
    await wait(40);set("height",keyboard+20); // A late browser-toolbar adjustment with no additional resize.
    await wait(350);
    check(Math.abs(document.body.getBoundingClientRect().height-keyboard-20)<1,"Settling pass catches the final toolbar/keyboard geometry");
    check(Math.abs(12+keyboard+20-$("composer").getBoundingClientRect().bottom-8)<1,"Late viewport adjustment does not leave a blank strip");
    $("input").value="Keyboard draft retained";$("input").dispatchEvent(new Event("input"));
    set("height",full);set("offsetTop",0);vv.dispatchEvent(new Event("resize"));await wait(350);
    check(root.dataset.chatKeyboard==="false"&&getComputedStyle(document.querySelector(".composer-wrap")).paddingBottom==="88px","Keyboard dismissal restores safe-area padding even if the input keeps focus");
    check($("input").value==="Keyboard draft retained"&&!composerCollapsed,"Keyboard transitions preserve the draft and expanded editor");
    $("chat-layout").value="desktop";$("chat-layout").onchange();
    check(!root.hasAttribute("data-chat-keyboard")&&!root.style.getPropertyValue("--chat-viewport-height"),"Desktop override clears keyboard adjustments");
  }finally{
    for(const [key,descriptor] of original){if(descriptor)Object.defineProperty(vv,key,descriptor);else delete vv[key];}
    root.style.removeProperty("--chat-bottom-safe-area");
    chatLayout="auto";applyChatLayout();$("input").blur();fitChatViewport();await wait(350);
  }
  return {viewport:[innerWidth,innerHeight],passed:checks.length,checks};
})();

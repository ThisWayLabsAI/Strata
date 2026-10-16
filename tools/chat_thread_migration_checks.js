// Fresh isolated browser: open fixture /not-found first, seed strata.chat and
// strata.chatModel with Legacy conversation/sc117, then open / and reload once.
(async () => {
  if (location.port !== "8092") throw new Error("Use CPU fixture 8092");
  const checks=[],check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label);};
  check(threadsReady && messages[0]?.text === "Legacy conversation","Existing chat migrates and survives refresh");
  check(conversationModel === "sc117","Existing model choice migrates");
  const before=await StrataThreads.list();
  check(before.length===1,"Migration creates exactly one thread");
  const repeated=await StrataThreads.initialize([{role:"user",text:"Wrong replacement"}],"original");
  check(repeated===null && (await StrataThreads.list()).length===1,"Migration marker prevents duplicate import");
  check((await StrataThreads.get(before[0].id)).messages[0].text==="Legacy conversation","Repeated import cannot replace saved history");
  return {passed:checks.length,checks};
})();

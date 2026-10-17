// Real monitor script, synthetic DOM/storage/fetch. No server, credentials or GPU.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../serve/web/monitor.js"), "utf8").replace(/\npoll\(\);\s*$/, "\n");
const sharedSlot = "strata.apikey", legacySlot = "strata.monitor.key";
function storage(blocked) {
  const values = new Map();
  return {values, getItem(key) {if(blocked)throw Error("blocked");return values.get(key)??null;},
    setItem(key,value) {if(blocked)throw Error("blocked");values.set(key,value);},
    removeItem(key) {if(blocked)throw Error("blocked");values.delete(key);}};
}
function fixture({shared,legacy,blocked=false}={}) {
  const local=storage(blocked),session=storage(blocked),elements=new Map(),events={},requests=[];
  if(shared!==undefined)local.values.set(sharedSlot,shared);
  if(legacy)session.values.set(legacySlot,legacy);
  const element=id=>{if(!elements.has(id))elements.set(id,{value:id==="filter"?"all":"",hidden:true,textContent:"",dataset:{},replaceChildren(){},append(){},setAttribute(){},focus(){}});return elements.get(id);};
  const status={model:"fixture",activity:{in_flight:0}};
  const history={requests:[],loaded:false,auto_load:true};
  const context=vm.createContext({document:{getElementById:element,documentElement:{dataset:{}},querySelectorAll:()=>[],createElement:()=>element(Symbol())},
    localStorage:local,sessionStorage:session,window:{addEventListener:(name,handler)=>events[name]=handler},
    fetch:async(url,options)=>{requests.push(options.headers.Authorization);return {ok:true,status:200,json:async()=>url==="/v1/status"?status:history};},setTimeout(){},console});
  vm.runInContext(source,context);
  return {local,session,element,events,requests,context,status,history,run:code=>vm.runInContext(code,context),
    change:async value=>{if(value===null)local.values.delete(sharedSlot);else local.values.set(sharedSlot,value);await events.storage({storageArea:local,key:sharedSlot,newValue:value});}};
}
async function main(){
  const checks=[],test=async(name,body)=>{await body();checks.push(name);};
  await test("Shared chat key overrides the old monitor key",async()=>{
    const f=fixture({shared:'"chat-key"',legacy:"old-key"});await f.run('api("/v1/status")');assert.equal(f.requests[0],"Bearer chat-key");assert.equal(f.element("api-key").value,"chat-key");
  });
  await test("Absent shared key permits the legacy session fallback",async()=>{
    const f=fixture({legacy:"old-key"});await f.run('api("/v1/status")');assert.equal(f.requests[0],"Bearer old-key");
  });
  await test("Empty, malformed and wrong-type shared values never revive the legacy key",async()=>{
    for(const shared of ['""','{','null','[]']){const f=fixture({shared,legacy:"old-key"});await f.run('api("/v1/status")');assert.equal(f.requests[0],undefined);}
  });
  await test("Manual Connect writes the JSON chat slot and retains session compatibility",async()=>{
    const f=fixture();f.element("api-key").value="  manual-key  ";await f.element("auth").onsubmit({preventDefault(){}});assert.equal(f.local.getItem(sharedSlot),'"manual-key"');assert.equal(f.session.getItem(legacySlot),"manual-key");assert.equal(f.requests[0],"Bearer manual-key");
  });
  await test("Cross-tab change replaces credentials, refreshes and clears stale session fallback",async()=>{
    const f=fixture({shared:'"first-key"',legacy:"old-key"});await f.change('"next-key"');assert.equal(f.requests[0],"Bearer next-key");assert.equal(f.element("api-key").value,"next-key");assert.equal(f.session.getItem(legacySlot),null);
  });
  await test("Cross-tab removal clears authentication without reviving an old key",async()=>{
    const f=fixture({shared:'"first-key"',legacy:"old-key"});await f.change(null);assert.equal(f.requests[0],undefined);assert.equal(f.run("storedApiKey()"),"");
  });
  await test("Cross-tab storage clear removes authentication",async()=>{
    const f=fixture({shared:'"first-key"',legacy:"old-key"});f.local.values.clear();await f.events.storage({storageArea:f.local,key:null,newValue:null});assert.equal(f.run("apiKey"),"");assert.equal(f.session.getItem(legacySlot),null);
  });
  await test("Unrelated preferences and session-storage events do not alter credentials",async()=>{
    const f=fixture({shared:'"first-key"'});await f.events.storage({storageArea:f.local,key:"strata.theme"});await f.events.storage({storageArea:f.session,key:sharedSlot});assert.equal(f.run("apiKey"),"first-key");assert.equal(f.requests.length,0);
  });
  await test("Manual entry remains usable when both storage APIs throw",async()=>{
    const f=fixture({blocked:true});f.element("api-key").value="memory-key";await f.element("auth").onsubmit({preventDefault(){}});assert.equal(f.requests[0],"Bearer memory-key");
  });
  await test("Polling does not close a manually opened key form",async()=>{
    const f=fixture({shared:'"chat-key"'});f.element("auth").hidden=false;await f.run("refresh()");assert.equal(f.element("auth").hidden,false);
  });
  await test("Delayed old-key 401 cannot disconnect a successful new-key refresh",async()=>{
    const f=fixture({shared:'"old-key"'}),pending=[];
    f.context.fetch=()=>new Promise(resolve=>pending.push(resolve));
    const old=f.run("refresh()"),changed=f.change('"new-key"');
    pending[2]({ok:true,status:200,json:async()=>f.status});pending[3]({ok:true,status:200,json:async()=>f.history});await changed;
    for(const resolve of pending.slice(0,2))resolve({ok:false,status:401,json:async()=>({error:{message:"old request"}})});
    await old;assert.equal(f.element("auth").hidden,true);assert.match(f.element("updated").textContent,/^Live/);assert.equal(f.element("error").hidden,true);
  });
  await test("An old detail response cannot mark a new invalid key connected",async()=>{
    const f=fixture({shared:'"old-key"'});let finishDetail;
    f.run('selected="r1"');
    f.context.fetch=async(url,options)=>{
      if(options.headers.Authorization!=="Bearer old-key")return {ok:false,status:401,json:async()=>({error:{message:"wrong key"}})};
      if(url.includes("?id="))return new Promise(resolve=>finishDetail=resolve);
      return {ok:true,status:200,json:async()=>url==="/v1/status"?f.status:{...f.history,requests:[{id:"r1",state:"completed",started_at:1}]}};
    };
    const old=f.run("refresh()");
    for(let i=0;i<20&&!finishDetail;i++)await Promise.resolve();
    assert.ok(finishDetail);await f.change('"invalid-key"');
    finishDetail({ok:true,status:200,json:async()=>({id:"r1"})});await old;
    assert.match(f.element("updated").textContent,/^Disconnected/);assert.equal(f.element("auth").hidden,false);
  });
  console.log(JSON.stringify({passed:checks.length,checks},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});

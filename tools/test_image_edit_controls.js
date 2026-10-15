// Pure contract checks, no DOM, GPU or external packages.
const {test} = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
for (const name of ["image-tools.js", "image-edit-controls.js"]) vm.runInThisContext(fs.readFileSync(path.join(__dirname,"../serve/web",name),"utf8"));
const api = StrataImageEditing;
test("No selected controls leave prompt bytes unchanged in both modes", () => {
  for (const operation of ["generate","edit"]) assert.equal(api.compose("A café cat\n",{},operation,1), "A café cat\n");
});
test("All selectable presets have validated, distinct instructions", () => {
  for (const [key, values] of Object.entries(api.presets)) {
    assert.equal(new Set(values.map(v=>v[0])).size,values.length);
    for (const [id,,text] of values) {
      const output = api.compose("Keep this draft.",{[key]:id},"edit",1);
      assert.ok(output.startsWith("Keep this draft.")); assert.ok(output.includes(text));
    }
  }
});
test("Region requires Edit, actual source and a free reference slot", () => {
  const config={region:[.1,.2,.3,.4]};
  for (const [operation,count] of [["generate",1],["edit",0],["edit",3]]) assert.throws(()=>api.compose("replace chair",config,operation,count),/free reference slot/);
  const output=api.compose("replace chair",config,"edit",2);
  assert.match(output,/Image 3 is a marked copy/); assert.match(output,/left 10%, top 20%, width 30%, height 40%/); assert.match(output,/Do not include the red box/);
});
test("Global camera or lighting with a region does not promise unchanged surroundings", () => {
  const output=api.compose("replace chair",{region:[0,0,.5,.5],camera:"side",lighting:"golden"},"edit",1);
  assert.match(output,/apply to the whole scene/); assert.doesNotMatch(output,/Preserve the scene and unselected/);
});
test("Recipe keeps whitelisted controls and draft without private fields", () => {
  const base={schema:"strata.image.v1",prompt:"final instructions",controlPrompt:"the draft",seed:0,size:"512x512",editing:{camera:"rear",lighting:"rim",region:[.1,.2,.3,.4],api_key:"secret",url:"private"}};
  const recipe=StrataImage.recipe(base);
  assert.deepEqual(recipe.editing,{camera:"rear",lighting:"rim",region:[.1,.2,.3,.4]}); assert.equal(recipe.controlPrompt,"the draft");
});
test("Malformed presets and regions cannot enter a reusable recipe", () => {
  for (const value of [{camera:"arbitrary"},{lighting:"private"},{region:[0,0,0,.1]},{region:[.9,0,.5,.2]},{region:[0,0,NaN,.5]},{region:"bad"}]) assert.throws(()=>StrataImage.editingSettings(value),/Invalid/);
});
test("Brush recipe identifies actual mask pixels and remains backwards compatible with box recipes", () => {
  const config={region:[.1,.2,.4,.5],regionMode:"brush"};
  assert.match(api.compose("replace",config,"edit",1),/White painted pixels/);
  assert.doesNotMatch(api.compose("replace",config,"edit",1),/red box at/);
  assert.equal(StrataImage.editingSettings(config).regionMode,"brush");
  assert.throws(()=>StrataImage.editingSettings({...config,regionMode:"unknown"}),/Invalid region/);
  assert.match(api.compose("replace",{region:config.region},"edit",1),/red box at/);
});
test("Protected edit blending leaves every zero-mask pixel byte-identical",()=>{
  const source=new Uint8ClampedArray([10,20,30,255,40,50,60,255,70,80,90,255]);
  const edited=new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255]);
  const mask=new Uint8ClampedArray([0,0,0,0,0,0,0,255,0,0,0,128]);
  api.blendSelection(source,edited,mask);
  assert.deepEqual([...source.slice(0,4)],[10,20,30,255]);assert.deepEqual([...source.slice(4,8)],[0,255,0,255]);
  assert.ok(source[10]>90 && source[10]<255);assert.throws(()=>api.blendSelection(source,new Uint8Array(1),mask),/Mismatched/);
});
test("Small edits get an in-bounds crop containing the selection; large edits stay full-frame",()=>{
  for(const r of [[.26,.35,.1,.08],[0,0,.02,.02],[.96,.96,.04,.04]]){
    const c=api.focusCrop(r,1024,1024);assert.ok(c && c.width===c.height && c.width<1024);
    assert.ok(c.x<=r[0]*1024 && c.y<=r[1]*1024 && c.x+c.width>=(r[0]+r[2])*1024 && c.y+c.height>=(r[1]+r[3])*1024);
  }
  assert.equal(api.focusCrop([.1,.1,.7,.7],1024,1024),null);
});
test("Local compositing and crop provenance survive the recipe whitelist",()=>{
  const value={region:[.2,.2,.1,.1],regionMode:"brush",preserveOutside:true,crop:[.1,.1,.3,.3],sourceSize:"1024x1024"};
  assert.deepEqual(StrataImage.editingSettings(value),value);
  assert.equal(StrataImage.editingSettings({...value,preserveOutside:false}).preserveOutside,false);
  assert.throws(()=>StrataImage.editingSettings({...value,crop:[.9,.1,.3,.3]}),/crop/);
});
test("Only explicit fur/hair color requests get an inferred black/white source-color instruction",()=>{
  assert.match(api.colorEdit("Change the selected area to white fur.","BLACK",1),/Replace the BLACK fur.*clean WHITE fur/);
  assert.match(api.colorEdit("Turn the painted region into blue hair","WHITE",2),/Image 3 is a selection mask/);
  for(const text of ["Remove the white fur.","Keep the selected area white.","Change the selected area to white fur, but preserve the black stripe."])
    assert.equal(api.colorEdit(text,"BLACK",1),null);
  assert.equal(api.colorEdit("Change the selected area to white fur.",null,1),null);
});
test("Camera direction and elevation combine independently without conflicting eye-level defaults",()=>{
  for(const camera of ["front","rear","side"]) {
    const text=api.compose("same scene",{camera,elevation:"low"},"edit",1);
    assert.match(text,/below eye level/);assert.doesNotMatch(text,/at eye level|looking horizontally/);
  }
  assert.match(api.compose("same scene",{camera:"overhead"},"edit",1),/directly above/);
});

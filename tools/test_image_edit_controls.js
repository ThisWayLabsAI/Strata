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

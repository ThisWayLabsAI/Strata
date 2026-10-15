# Camera, lighting and region-guided edits

First version, 2026-10-15. These optional controls are in **Images → Camera, lighting & edit region**. They work with the installed image backend and existing references. They do not yet add editing tools to chat.

## Use it

Write the scene or requested changes in Prompt. Choose any camera, framing or lighting presets, then review **Prompt that will be sent**. The draft is kept intact; the selected instructions are added only to the request. The defaults are **Unchanged / prompt decides**, preserving the previous request prompt. Reset presets clears these choices. Selecting a preset never starts generation or changes the operation, source references, size or seed.

Camera angles: front, three-quarter, side profile, rear, high angle, low angle and overhead. Framing: close-up/tighter, medium shot, wide/farther back and full subject. These describe a generated view, not a calibrated camera or numerical optical zoom; new views and wider framing may invent hidden details.

Lighting: soft studio, overcast daylight, golden hour, dramatic side light, rim/backlight, high key, low key and neon/cinematic. Camera, framing and lighting instructions apply to the whole scene. They override conflicting camera/lighting wording in the draft. Accuracy depends on the model and prompt; they do not guarantee physically exact lighting or geometry.

For a targeted edit, select **Edit a source image**, upload the original as image 1, and enable **Mark an edit region**. Draw a rectangular box with mouse or touch. Select center is an alternative; focus the image and use arrows to move or Shift + arrows to resize. Enter/Space selects the center. Clear region removes the selection. Describe what to replace/change in Prompt, then submit Edit image.

The original reference bytes remain unchanged. A separate marked copy, at most 1024 pixels on its longest side, is appended as a composition reference. Instructions identify it as a locator and ask the model to omit the red guide from the result. This uses one of the existing three reference slots, so a region edit allows at most two uploaded references. Inputs are never dropped to make room. Three references, an incomplete gesture, an unavailable source or a missing region produce a visible error before submission.

The box is annotation guidance, not a hard inpainting mask. Pixels outside it may change. With camera or lighting selected, changes elsewhere are intentional. Freehand brushes, segmentation, exact outside-mask compositing, multiple regions and guaranteed identity preservation are not part of this version.

## References, templates and recipes

Changing/reordering image 1 clears an existing region when its source bytes change. Switching to Generate suspends the region and never sends its guide; switching back permits reuse only for the same source. During generation, presets, references and region editing are locked. Cancel uses the existing image subprocess/GPU cleanup.

Applying a starter, saved or result template preserves selected camera/lighting/framing controls, the region and current references. Saved templates keep their existing prompt/settings behavior; preset selections are separate controls and are not automatically stored in template-library entries. They are not automatically retained across page refresh.

UI PNG recipes optionally store whitelisted `editing` fields: `camera`, `framing`, `lighting`, and normalized `region: [left, top, width, height]`. `controlPrompt` stores the draft before generated control instructions, while `prompt` remains the actual generation prompt. Existing `templatePrompt` retains the reusable base treatment. Reference provenance includes the marked guide's normalized hash and role, without embedding source bytes, local paths or URLs. Raw API image bytes remain unchanged.

Loading a PNG recipe restores the draft and presets without duplicating generated instructions. It clears references as before and requires the original source and region to be selected again. Coordinates alone are not sufficient to safely recreate a guide. Use as template continues to preserve the current controls/references rather than restoring the recipe's source.

## Implementation and checks

`serve/web/image-edit-controls.js` owns preset instructions, preview, pointer/keyboard input, source invalidation and request preparation. It adds a bounded guide to the existing `references` contract; no new API, model, encoder, package or machine-config setting is required. The default tool and Images paths keep their previous request prompt/reference bytes when controls are unused.

Checks passed: 22 Node tests (16 existing recipe/template tests plus 6 control contracts), 33 Python image/reference regressions and 735 Chromium fixture checks. Each of 320x568, 390x844, 844x390, 1280x800 and 390x300 ran 26 new editing checks plus 23 template-context, 21 reference, 25 recipe, 33 mobile-chat and 19 chat-image checks. Coverage includes guide pixels, normalized coordinates, touch-event mapping, keyboard movement/resize, cancelled gestures, duplicate-free recipe reuse, reference limits, unchanged originals, busy-state locks and default requests. A real mouse drag was checked and the mobile screenshot visually reviewed. Actual iOS/Android gestures and keyboards remain untested.

Hardware checks use the existing authenticated live image API, with no second GPU server or service restart. Original Qwen's configured Qwen-Image-2.1-Turbo Q8_0 CUDA backend generated 512x512 edits at 8 steps. Seed 720 tested three-quarter/full-subject/rim presets (12.84 s endpoint latency); inspection showed only a modest viewpoint change and weak visible rim lighting. Seed 721 tested a marked head replacement (10.72 s): the robot's head became a green sphere, the body/background stayed visually similar, and the guide outline was absent. These first requests used keep policy. A separate side-profile/full-subject/neon test, seed 720, took 12.77 s and used unload policy; inspection showed a clear side view and cyan/magenta illumination. Subsequent chat returned READY after both runs, with no request remaining in flight. This is visual inspection, not pixel equality or a quality benchmark. Other models/backends were not re-tested for this frontend-only increment.

## Release and rollback

Feature branch: `feature/image-edit-controls`, based on stable `008a0f10c98f1c82b71e6984bcba3cc4d77ff07b`. Preserve that base as `rollback/pre-image-edit-controls-20261015`. Deploy the HTML/CSS/JS together and hard-refresh the browser. No restart is required. Roll back the source together; existing PNG recipes remain files and optional new fields can be ignored by older source. Keep all configs, keys, models, controls and reference originals.

The next larger increment remains explicit reference generation/editing in chat, followed by model switching. The visual controls can be reused there after request-owned reference selection is implemented.

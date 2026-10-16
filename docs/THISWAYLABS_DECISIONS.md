# Thiswaylabs implementation decisions

Recorded 2026-10-15. This is the decision record for the local fork; use [the handoff](THISWAYLABS_HANDOFF.md) for deployment state and [feature plans](THISWAYLABS_FEATURE_PLANS.md) for acceptance criteria.

## Implemented in development: explicit chat reference editing

Continue from stable/live `919e9866` on `feature/chat-image-editing`. The [chat reference contract](CHAT_IMAGE_EDITING.md) implements the planned request-owned inputs, explicit operation and selected roles. Attachments alone remain analysis; saved output selection is explicit. The model receives bounded reference IDs/roles and must return the exact ordered selection. Invalid or missing references fail without generation fallback. Existing one-attempt orchestration, GPU ownership, output storage and cancellation remain shared. Final numbered role guidance and actual settings enter recipes; source bytes and private input names do not. Temporary input references require reselection after refresh. This does not add brush compositing to chat or improve camera compliance.

Mocks and Chromium fixtures precede coordinated hardware tests. Keep live Images available while the user tests; no production stop/restart or backend rollout has occurred for this increment. Hardware output quality, both models and safe recovery must be verified before local deployment. No keys, configs, packages, installed models or controls change. Model switching remains next after this release gate.

## Image submission feedback

Images validates only the request's prompt, sampling fields and edit prerequisites. Unused URL/import/template fields must not prevent native button submission. Keep the written prompt required, including when presets are selected, and explain this requirement. Missing edit sources/support and file-reading busy states explain disabled buttons in the footer. Retain errors beside the actions, reveal/focus invalid sampling fields, preserve draft/references, and never replay a failed request automatically. Browser regressions must exercise button clicks, since calling `onsubmit` directly bypasses native constraint validation. See the handoff for measured checks and deployment baseline.

## Accepted: text-to-image chat increment

Application commit `996c3cbf503817d9943614555cff61e1def7fb79` is deployed locally. After enabling **Create images in chat**, the user reported successful generation and agreed to move on while continuing exploratory testing. This accepts the first text-to-image increment; it does not close outstanding actual-phone checks or establish broad model quality.

- Keep chat generation opt-in per browser and explicit per API request (`strata_images: true`). Ordinary text, prompt-writing and image-analysis requests must retain their behavior. Mobile layout is the separate user-requested exception: Automatic by default with saved Mobile/Desktop overrides.
- Reuse the existing image runner and `gpu_turn`. Release the text inference turn before starting image work, then reacquire a normal turn for continuation. Never recursively call the image HTTP route while holding chat ownership. Keep the configured GPU policy and installed assets.
- Permit one image attempt per chat request, including failures. Use stable call/job IDs and ordered events. Deduplicate events and repeated call IDs within that request. Do not automatically reconnect/replay HTTP requests or regenerate missing previews. Cross-request idempotency remains unimplemented.
- Deliver typed image events through the authenticated chat response. Give the text model a short result summary, without base64 pixels. A successful image survives a later chat-recovery error.
- Store completed blobs/recipes in browser IndexedDB and metadata in the transcript. Storage is per browser/origin, with visible failure warnings, downloads and deletion after Undo. Do not depend on bounded server output retention or claim cross-device history.
- Embed the actual prompt, seed, dimensions and reported generation settings in UI PNG downloads through the existing recipe helper. API output bytes remain compatible. Applying a template preserves the current Images operation and selected references; explicit PNG recipe import restores its recorded operation and clears references deliberately.
- Keep reference editing in Images for this release. A chat photo attachment is vision input and is not automatically an image-generation reference. Do not describe an attached photo as having been used by the current text-only tool.

Evidence: 82 Python tests, 16 Node tests and 232 Chromium fixture checks passed. Original and SC117 passed hardware generation, continuation and cancellation recovery; a native SC117 browser run restored a generated PNG after refresh. Live Original Qwen generated seed 610 at 512x512, resumed chat and answered 17×23 = 391 afterward. The live web MCP server reported three tools. See [CHAT_IMAGES.md](CHAT_IMAGES.md) for the contract and measured limits.

## Next increment: explicit references and editing in chat

Before that integration, the user requested a first version of visual editing controls and camera/lighting presets in Images. [IMAGE_EDIT_CONTROLS.md](IMAGE_EDIT_CONTROLS.md) records this intervening increment. Use a separate annotated copy as a region locator, preserving the original and the existing three-reference cap. Default presets add no instructions; selected presets apply globally. Store actual instructions and optional control provenance in PNG recipes. Do not call the annotation a hard mask or promise exact camera/lighting compliance. Keep these controls reusable for the later chat integration.

The user's follow-up adds Brush as the default selection tool, with Box retained, and a separate monochrome selection-mask reference for freehand targets. Preserve originals and cap undo history at five strokes. Detect a reference PNG's recipe but require an explicit Load recipe action; preserve its current reference set and operation. Keep the standalone picker behavior for importing recipes without references. Show indeterminate animated progress rather than inventing percentages. This is a frontend-only refinement while the user continues editing tests.

After the user's cat-fur failure, local UI edits now default to preserving unselected decoded source pixels through compositing, with small brush crops for model attention. A mask prompt alone was insufficient. A narrow, visible fur/hair color instruction expansion addresses the confirmed short request without adding hidden model calls. Global view/elevation/framing/lighting requests bypass local compositing. Camera direction and elevation are separate user choices; the installed model's failure to honor several tested views remains explicit. See [IMAGE_EDIT_FIDELITY.md](IMAGE_EDIT_FIDELITY.md); do not equate passing transport/UI tests with model editing quality.

Extend the existing chat image orchestration and validated reference backend before model switching. Expose a distinct edit operation, with explicit reference selection and ordered roles. Keep analysis-only attachments and new-image generation unambiguous. Resolve only references authorized for the request; the model must not choose arbitrary filesystem paths, fetch arbitrary URLs or silently reuse unrelated history images. Preserve recipe provenance, downloads, cancellation and GPU handoff. The detailed proposed steps and acceptance criteria are in [feature plans](THISWAYLABS_FEATURE_PLANS.md#next-increment-reference-aware-generation-and-editing-in-chat).

This is the next implementation scope, not a claim that chat editing already works. Portable reference bundles, cross-device storage and HTTP resume remain separate follow-ups. Model switching follows this increment and must invalidate model-specific caches and serialize transitions with image work.

## Local deployment and preservation

Keep `main` as the upstream mirror and develop in `C:\AI\Strata-dev`. Stable source is `thiswaylabs` in both local checkouts; live runs in `C:\AI\Strata`. GitHub publication/PR remains pending authentication. Do not imply that local commits are pushed; use reviewed local bundles and fast-forwards while publication is unavailable.

Preserve configs, API keys, weights, packs, shared Python packages, machine controls and scheduled tasks. Use one GPU server at a time. Backend changes need a coordinated stop/test/deploy/start; docs-only commits need no restart. Record rollback source before code deployment and keep runtime data during rollback. The chat-image rollback branch points to `6d904c34323552f5dfb1ec1caf6e210fd6950bdd`.

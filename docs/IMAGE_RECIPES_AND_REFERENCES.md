# Image recipes, templates and reference editing

Updated 2026-10-15. This records the implemented recipe/template increment and the recommended editing follow-up.

## Implemented in Images

New UI-generated previews and PNG downloads carry an uncompressed UTF-8 PNG `iTXt` chunk named `strata.image`. Its JSON schema is `strata.image.v1`. It stores the actual returned prompt and seed, output dimensions, generation date, returned image model ID, reported steps/backend/quantization and the starting template name. A differing original submitted prompt is retained separately. Unknown/private fields are excluded. No API keys or machine paths are added.

`serve/web/image-tools.js` inserts the recipe before IEND, replaces an existing Strata recipe, and preserves every other PNG chunk byte-for-byte, including pixel data and existing generator parameters. It checks signatures, lengths, checksums and limits. The browser annotates its copy; the image API and server-stored raw image bytes are unchanged. API callers do not receive new metadata behavior implicitly.

Each result offers Download PNG + recipe, Use as template, Discuss in chat and Generation recipe details. Loading a recipe from a PNG restores prompt, fixed seed, supported size and reported steps. It displays original model provenance; this does not switch the installed image model. Unsupported original sizes leave the current size selected and show a warning. Images without a Strata recipe cannot supply missing settings. Re-saving through another app may strip metadata; keep the downloaded original.

Attaching a metadata-bearing PNG in chat extracts its recipe into a JSON user attachment, labeled as untrusted data rather than instructions. Vision-enabled chat also receives the image. Text-only chat still receives the recipe. Discuss in chat prepares those attachments and a draft; it does not submit a request or generate an image. Direct chat-to-image tool execution remains a separate planned feature.

Steps are optional (1–100); an empty field keeps the server default. Recipes record steps reported by the response, rather than assuming a default. Prompt length is limited to 16,384 characters. PNG imports are limited to 20 MB, recipe text to 64 KiB, chunk count to 10,000, and parser output to whitelisted fields. A PNG annotation failure leaves the original image downloadable and shows an explicit warning.

## Starter and saved templates

The collapsible library contains 24 editable starters. Add a subject/scene and apply one to fill the prompt and suggested size. Applying a template does not generate an image.

| Group | Starters |
| --- | --- |
| Comics and illustration | Marvel-style comic, DC-style comic, Pixar-style animation, anime/manga, watercolor |
| Photographic and design uses | Live action/cinematic, fashion editorial, location/establishing shot, prop concept, fantasy, science fiction, architectural interior, food photography, product photography, seamless texture starter |
| Sheets and sets | Character turnaround, character expressions, prop views, environment views, costume exploration, material variations, vehicle views, storyboard sequence, matching icons |

All sheet prompts explicitly request consistent designs and no letters, numbers, labels, captions, signatures, logos or watermarks. They are instructions to the generator, not a measured guarantee of text-free output or perfect tileability.

Save template stores the current prompt, size, fixed/random choice, seed and optional steps in this browser (`strata.imageTemplates`). A matching name updates an existing saved template; different names create separate entries, up to 30. Saved templates can be applied or deleted. Storage failure is reported as temporary in-memory availability. No server config or shared files are modified.

## Verification

- 11 Node tests cover Unicode/zero-seed round-trip, unchanged pixel and existing metadata chunks, replacement, malformed/duplicate/checksum-invalid/oversized data, unsafe seeds, whitelisting, typed-array offsets and starter coverage.
- The 25 recipe/template UI checks and 23 seed/keyboard UI checks pass at 320x568, 390x844, 844x390, 1280x800 and 390x300. They exercise actual canned image responses, restoration, template storage, safe rendering of hostile metadata, attachment flow, waiting for image/recipe reads before Send, and text-only chat. All 33 mobile-chat regression checks and 29 existing image/monitor tests also passed.
- The saved PNG bytes referenced by the download anchor were written to a workspace file, checked independently in Node, uploaded using the browser's file picker and imported successfully. Custom templates also survived a browser refresh.
- Native browser download automation was cancelled by this sandbox for ordinary HTTP, blob and PNG links alike. The portable file round-trip is verified; native phone download/save behavior remains a device check. No live GPU generation or image-style quality benchmark was run for this frontend-only increment.

## Reference editing implemented in Images (2026-10-15)

The Images workspace now has Generate / Edit, up to three ordered uploads, thumbnails, role labels, remove/reorder controls, browser URL import, Edit this image on results, and cancellation. Edit requires a first source image; additional references can be identity, style or composition. Roles are workflow labels, not separate model conditioning switches: describe the numbered images and desired changes in the prompt. Generate can also use references.

References are still PNG/JPEG/WebP, at most 8 MB each, 20 MB total, and 16 megapixels each. Animated and invalid files are rejected. The server normalizes orientation and RGB pixels into fresh PNGs without uploaded metadata, enforces a second 20 MB limit on normalized files, and computes SHA-256 over those normalized PNG bytes. Runner filenames are created by the server inside its temporary job directory; user paths and URLs are never passed to the runner. All temporary inputs/outputs are removed after success, failure or cancellation. URL import uses a bounded browser fetch, without Strata API credentials, cookies, referrers or redirects. The host must allow CORS; otherwise download/upload the image. There is no server URL fetch endpoint.

The authenticated `GET /v1/images/capabilities` reports readiness and input limits. Optional JSON `references` work on `POST /v1/images/generations`; `POST /v1/images/edits` uses the same JSON contract but requires references. This is a Strata JSON extension, not OpenAI multipart editing compatibility. Example reference: `{"data":"data:image/png;base64,...","name":"source.png","role":"source"}`. Only data/name/role are accepted. Both routes use the same FIFO, GPU handoff and runner. Reference jobs reserve additional projector/encoding memory; no-reference runner arguments and API response shape stay unchanged. Queue/busy state is cleared even if handoff fails.

Configure `images.llm_vision` with the compatible projector path. The optional installer `tools/image/install_reference_projector.py --destination <new-folder>` adds only the projector and manifest, verifies the pinned SHA-256, and never rewrites configs. Pillow is required only for references/capability readiness; the local live environment already had Pillow 12.3.0, so no packages were changed. The installed runner remains unchanged at stable-diffusion.cpp commit `2988060a4338a5dcd94721c964a8e87003c1ac8b`.

Pinned projector: official `Qwen/Qwen3-VL-8B-Instruct-GGUF`, revision `f982a07559d4a2f6c8744d840bf6fccab30eea96`, `mmproj-Qwen3VL-8B-Instruct-F16.gguf`, 1,159,029,824 bytes, SHA-256 `ca524100ebf825c9a870db1c580d03879e0da0ab2541697e2458e64891cf9d38`. On this PC it is under `C:\AI\Strata-data\models\qwen-image-2.1-turbo\vision`. Existing diffusion weights, text encoder and VAE are unchanged.

PNG recipes optionally include `operation` and ordered `references` containing name, role and normalized SHA-256. They contain neither reference pixels nor source URLs. Loading a recipe clears current references and requires the originals again for Edit. Save template remembers Edit mode, but never stores reference bytes. Browser refresh clears uploads. Keep originals; a portable reference bundle is still a follow-up. Discuss in chat continues to attach the result and recipe; chat cannot yet call generation/editing as a tool.

Verification: 43 Python image/reference/monitor tests and 12 Node metadata tests pass. The 20 reference checks, 25 recipe checks and 23 seed/keyboard checks pass at 320x568, 390x844, 844x390, 1280x800 and 390x300; all 33 mobile-chat regressions pass at 320x568. No browser JavaScript errors reported. Real phone keyboard/download checks remain open.

Hardware smoke test: NVIDIA GeForce RTX 3090 (24 GiB), CUDA, Qwen-Image-2.1-Turbo Q8_0, 512x512, 8 steps. Generation seed 101 took 8.03 s runner time; a source-image edit seed 202 took 9.62 s; source plus purple style reference seed 303 took 10.83 s. The source was a red/white toy robot on a gray pedestal against blue; visually inspected edits changed the background to yellow/purple and retained the robot/pedestal. Both edits unloaded chat after saving its conversation; chat reload restored the session and answered 17×23 = 391. Disconnecting a real edit stopped the runner; the queue released and chat answered READY after restoration. This is a short smoke test, not a broad identity/quality benchmark. SC117, other GPUs/backends, three-reference visual quality and real Safari/Android were not tested. The development MCP web tool hit the sandbox's uv-cache restriction; this is not evidence of live tool failure.

## Remaining integration: image tools in chat

Images should be the full workspace: choose Generate or Edit, add one or more references, inspect thumbnails, remove/reorder them, set a prompt and seed, then generate. Chat should call the same image service after releasing its inference turn, rather than implementing another generator or recursively calling a locked HTTP endpoint. Existing GPU ownership must cover both entry points and all failure/cancellation paths.

The installed runner's `docs/qwen_image_2.1.md` documents repeated `-r` inputs and `--llm_vision`; the implemented path above has now been exercised on this PC. The following original increments retain the intended progression; steps 1–5 are implemented to the extent described above, while portable bundles and chat tools remain open.

Recommended increments:

1. Validate the exact compatible projector, runner flags and installed Turbo editing behavior in development. Pin any required weight revision/hash. Keep model downloads and config changes separate from the current frontend release; preserve the working generator.
2. Add an explicit reference/edit contract and capabilities response. Validate bounded image uploads, dimensions and supported reference count; reject unsupported edit requests. Use one shared job service and the existing GPU handoff for standalone Images, API requests and later chat tools. Test failure, cancellation and restoration before rollout.
3. Start with file uploads, first one reference and then multiple if the validated backend supports them. Separate the image being edited from additional identity/style/composition references so the user understands each input's role.
4. Add URL import by downloading a bounded supported image into the same validated local reference-input pipeline. Show a preview before generation. Do not silently hotlink changing remote content or let the runner fetch arbitrary URLs or local paths. Apply URL/network restrictions before implementing server-side fetching; handle private/authenticated sources explicitly.
5. Extend recipe provenance with operation, reference roles and content hashes. A seed and prompt alone cannot recreate a reference edit without the actual source images. Add an explicit export bundle if the user wants portable references alongside the recipe; omit credential-bearing source URLs from embedded public metadata.
6. Expose the validated service as chat image tools, with inline job/result state, explicit capabilities and the same download/template controls. Preserve client-owned tools and keep generation outside the active text inference turn.

Acceptance includes identity-preserving examples, multiple-reference ordering, bounded uploads/URL imports, unsupported-capability errors, actual output seed/provenance, no overlap with chat inference, and failure/cancellation recovery. Coverage and remaining device/hardware checks are recorded above. Chat-tool integration must release the inference turn before entering this shared service.

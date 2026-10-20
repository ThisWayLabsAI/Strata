# Vision input policy

`"vision_input_policy": "uploads_only"` restricts client-supplied vision inputs to base64 `data:image/` URLs.
Select a photo/file in the browser as before; it uploads its bytes. API clients must read the image on their
own device and send those bytes. Server-side paths, `file:` URLs and HTTP(S) image URLs receive a 400 response.
This setting applies to Chat Completions, Messages, Responses and Messages token-count inputs, including
image content returned by client-managed tools. Model switching retains the service-wide policy.

Example run-config entry:

```json
{
  "vision_input_policy": "uploads_only"
}
```

The default `"legacy"` preserves upstream file/URL behavior for other installations. Unsupported setting values
fail startup before native loading. The setting is owned by the run config; clients cannot override it in a
request, and the web Settings endpoint cannot change it. The hardened policy is reported under
`vision.input_policy` in authenticated `/v1/status`.

The policy is checked before client image reads/downloads, with a second check in prompt preparation before
tool-image processing. It does not change the native decoder, weights, image generation/reference editing,
or downloaded output access. It does not restrict the separately configured web-search MCP server.

Deploying or reverting this config/server change requires a coordinated idle/Stop/shutdown/start gate.
Preserve keys, registry entries and every other run-config value. The local deployment explicitly enables
the setting in both live and both development configs; see the handoff for actual deployment status.

Validation uses mocks for rejected paths/URLs with read/download methods instrumented to assert no access,
all four API routes, tool-image preparation, invalid settings, and policy retention across both model choices.
Native/browser results and limits belong in the dated deployment record rather than being inferred from mocks.

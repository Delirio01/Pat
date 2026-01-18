# xAI models — working notes

These are lightweight notes to keep context close to the codebase when choosing models / adding capabilities like tool calling and image generation.

## Grok 4.1 Fast

- Positioning: frontier multimodal model optimized for high-performance agentic tool calling
- Context window: 2,000,000 tokens
- Capabilities:
  - Function calling (tools)
  - Structured outputs
  - Reasoning
- Pricing (as provided):
  - Input: $0.20 / 1M tokens
  - Output: $0.50 / 1M tokens
- Rate limits (as provided): 4M TPM, 480 RPM (request increase if needed)

## Models in the UI

The model selector in `pat/app/components/ChatApp.tsx` currently includes:

- `grok-4-1-fast-reasoning`
- `grok-4-1-fast-non-reasoning`
- `grok-4-fast-reasoning`
- `grok-4-fast-non-reasoning`
- `grok-4-0709`
- `grok-code-fast-1`
- `grok-3`
- `grok-3-mini`
- `grok-2-vision-1212`

Image generation models are not currently wired into the UI, but one example you provided is:

- `grok-2-image-1212`


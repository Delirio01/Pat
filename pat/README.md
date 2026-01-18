This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Create `pat/.env.local`:

```bash
cp .env.example .env.local
```

Set `XAI_API_KEY` in `pat/.env.local` (do not commit it).

Optional (web scrape mode):
- Set `FIRECRAWL_API_KEY` in `pat/.env.local`
- Enable it in the app at `http://localhost:3000/settings` (Pat will auto-attach page content for URLs and Grok can request a scrape as a tool)
- Command: `/scrape https://example.com your question`

## xAI Models (Notes)

Quick reference notes I can keep in-repo for later planning: `pat/docs/xai-models.md`.

Highlights:
- **Grok 4.1 Fast**: frontier multimodal model optimized for high-performance agentic tool calling
- **Context window**: 2,000,000 tokens
- **Capabilities**: function calling (tools), structured outputs, reasoning
- **Image generation**: available via image models (example: `grok-2-image-1212`)

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

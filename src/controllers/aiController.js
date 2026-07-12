import { GoogleGenAI } from '@google/genai'
import { cacheGet, cacheSet } from '../config/redis.js'

let ai = null
function getAI() {
  if (!ai && process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  }
  return ai
}

async function generateText(prompt, { maxTokens = 1024, temperature = 0.7 } = {}) {
  const client = getAI()
  if (!client) return null
  const response = await client.models.generateContent({
    model:    'gemini-2.5-flash',
    contents: prompt,
    config:   {
      maxOutputTokens: maxTokens,
      temperature,
      thinkingConfig: { thinkingBudget: 0 },
    },
  })
  return response.text
}

// ── Explain / Summarize / Define ──────────────────────────────────────────────
export async function handleQuery({ text, bookId, cfi, action, progress }) {
  const cacheKey = `ai:${bookId}:${action}:${hashStr(text)}`
  const cached   = await cacheGet(cacheKey)
  if (cached) return cached

  const systemCtx = `You are a literary AI assistant. The reader is ${Math.round(progress || 0)}% through the book. Be clear and complete — always finish your sentences and thoughts. Never reveal future plot events. Plain text only, no markdown.`

  let response
  try {
    const result = await generateText(
      `${systemCtx}\n\n${buildPrompt(action, text)}`,
      { maxTokens: 1500, temperature: 0.7 }
    )
    response = result || mockResponse(action)
  } catch (err) {
    console.error('Gemini query error:', err.message)
    response = mockResponse(action)
  }

  const result = { response }
  await cacheSet(cacheKey, result, 7200)
  return result
}

// ── Chat ──────────────────────────────────────────────────────────────────────
export async function handleChat({ message, history, bookId, bookTitle, progress }) {
  const client = getAI()
  if (!client) return { content: mockChatResponse() }
  try {
    const systemCtx = `You are an AI literary companion for "${bookTitle || 'this book'}". The reader is ${Math.round(progress || 0)}% through. Answer helpfully and insightfully. Always complete your thoughts — never cut off mid-sentence. Never spoil future events. Plain text only, no markdown.`
    const historyText = history.map(m => `${m.role === 'user' ? 'Reader' : 'Assistant'}: ${m.content}`).join('\n')
    const fullPrompt  = `${systemCtx}\n\n${historyText ? `Previous conversation:\n${historyText}\n\n` : ''}Reader: ${message}\nAssistant:`
    const text = await generateText(fullPrompt, { maxTokens: 2000, temperature: 0.75 })
    if (!text) throw new Error('empty')
    return { content: text.trim() }
  } catch (err) {
    console.error('Gemini chat error:', err.message)
    return { content: mockChatResponse() }
  }
}

// ── Imagine — context-aware prompt + 3-layer image generation fallback ────────
export async function handleImagine({ text, bookId, bookTitle, progress }) {
  const cacheKey = `imagine:${bookId}:${hashStr(text)}`
  const cached   = await cacheGet(cacheKey)
  if (cached) return cached

  const client = getAI()
  const pct    = Math.round(progress || 0)

  // ── Single Gemini call: excerpt + book title + progress → detailed image prompt
  // Gemini uses its training knowledge of the book AND the raw excerpt together.
  // This gives character appearances (skin, hair, clothing, distinctive features),
  // world/setting details, and the exact mood of this scene — all in one shot.
  let imagePrompt = `Cinematic fantasy illustration of a scene from "${bookTitle || 'a novel'}": ${text.slice(0, 200)}, painterly, highly detailed, dramatic lighting`

  try {
    if (client) {
      const enriched = await generateText(
         `You are an expert at writing photorealistic image generation prompts for literary scenes.\n\n` +
        `Book: "${bookTitle || 'Unknown'}"\n` +
        `Reader is ${pct}% through the book.\n\n` +
        `Excerpt:\n"${text.slice(0, 600)}"\n\n` +
        `Using your knowledge of this book AND the excerpt above, write a single image generation prompt (80-120 words) that:\n` +
        `1. Names and physically describes every character present — ` +
        `exact skin tone, hair color, eye color, face structure, build, and the precise clothing or armor they wear in this book. ` +
        `Include distinctive features (scars, unusual eyes, glowing effects, etc.)\n` +
        `2. Describes the specific real-world setting — architecture, landscape, weather, natural or artificial light sources, time of day, colors\n` +
        `3. Captures the exact action and emotional tension of this moment\n` +
        `4. Ends with ONLY these style keywords (copy them exactly): ` +
        `photorealistic, cinematic photography, 85mm lens, shallow depth of field, cinematic lighting, ` +
        `film grain, 8K resolution, hyperrealistic, shot on Sony A7R, RAW photo\n\n` +
        `CRITICAL RULES:\n` +
        `- Never use words like: illustration, painting, artwork, drawn, render, fantasy art, anime, cartoon, digital art, concept art\n` +
        `- Describe characters as real people with real proportions, not stylized\n` +
        `- Be extremely specific — no vague descriptions like "a warrior" or "a young woman"\n` +
        `- Output only the prompt text, no preamble, no commentary, no quotes around it`,
        { maxTokens: 400, temperature: 0.6 }
      )
      if (enriched) imagePrompt = enriched.trim()
      console.log('[Imagine] Generated prompt:\n' + imagePrompt + '\n')
    }
  } catch (err) {
    console.warn('[Imagine] Prompt generation failed:', err.message)
  }

  // ── Helper: convert raw image blob response → base64 data URL ────────────
async function blobResponseToBase64(response) {
  const contentType = response.headers.get('content-type') || 'image/jpeg'
  // Reject if server returned JSON (error body) instead of an image
  if (contentType.includes('application/json')) {
    const body = await response.text()
    throw new Error(`Expected image, got JSON: ${body.slice(0, 200)}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  // Reject suspiciously small responses (likely an error page, not an image)
  if (arrayBuffer.byteLength < 1000) {
    throw new Error(`Response too small to be an image: ${arrayBuffer.byteLength} bytes`)
  }
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  return `data:${contentType.split(';')[0]};base64,${base64}`
}

  let imageUrl = null

  // ── Layer 1: HuggingFace FLUX.1-schnell (fastest, best quality) ──────────
  if (!imageUrl && process.env.HF_TOKEN) {
    try {
      console.log('[Imagine] Trying HF FLUX.1-schnell...')
      const res = await fetch(
        'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
        {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${process.env.HF_TOKEN}`,
            'Content-Type':  'application/json',
          },
          body:   JSON.stringify({ inputs: imagePrompt }),
          signal: AbortSignal.timeout(25000),
        }
      )
      if (res.ok) {
        imageUrl = await blobResponseToBase64(res)
        console.log('[Imagine] FLUX.1-schnell success')
      } else {
        console.warn('[Imagine] FLUX.1-schnell failed:', res.status, await res.text())
      }
    } catch (err) {
      console.warn('[Imagine] FLUX.1-schnell error:', err.message)
    }
  }

  // ── Layer 2: HuggingFace stable-diffusion-3-medium ───────────────────────
  if (!imageUrl && process.env.HF_TOKEN) {
    try {
      console.log('[Imagine] Trying HF SD3-medium...')
      const res = await fetch(
        'https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers',
        {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${process.env.HF_TOKEN}`,
            'Content-Type':  'application/json',
          },
          body:   JSON.stringify({ inputs: imagePrompt }),
          signal: AbortSignal.timeout(30000),
        }
      )
      if (res.ok) {
        imageUrl = await blobResponseToBase64(res)
        console.log('[Imagine] SD3-medium success')
      } else {
        console.warn('[Imagine] SD3-medium failed:', res.status, await res.text())
      }
    } catch (err) {
      console.warn('[Imagine] SD3-medium error:', err.message)
    }
  }

  // ── Layer 3: Cloudflare Worker (SDXL-base-1.0) ───────────────────────────
  if (!imageUrl && process.env.CF_IMAGE_URL && process.env.CF_IMAGE_KEY) {
    try {
      console.log('[Imagine] Trying Cloudflare SDXL...')
      const res = await fetch(process.env.CF_IMAGE_URL, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${process.env.CF_IMAGE_KEY}`,
          'Content-Type':  'application/json',
        },
        body:   JSON.stringify({ prompt: imagePrompt }),
        signal: AbortSignal.timeout(30000),
      })
      if (res.ok) {
        imageUrl = await blobResponseToBase64(res)
        console.log('[Imagine] Cloudflare SDXL success')
      } else {
        console.warn('[Imagine] Cloudflare SDXL failed:', res.status, await res.text())
      }
    } catch (err) {
      console.warn('[Imagine] Cloudflare SDXL error:', err.message)
    }
  }

  // ── Scene description: always generated, shown below image or alone ───────
  let description = null
  try {
    if (client) {
      description = await generateText(
        `In 2-3 vivid sentences, describe what this scene looks like visually — ` +
        `the characters, setting, lighting, and mood. Write as if describing a painting. ` +
        `Scene from "${bookTitle || 'the book'}" (${pct}% through):\n"${text.slice(0, 300)}"`,
        { maxTokens: 150, temperature: 0.75 }
      )
    }
  } catch {}

  if (!description) {
    description = `${text.slice(0, 150)}…`
  }

  const result = {
    imageUrl,
    imagePrompt,
    description,
    placeholder: !imageUrl,
  }
  await cacheSet(cacheKey, result, imageUrl ? 86400 : 300)
  return result
}

// ── Recap ─────────────────────────────────────────────────────────────────────
export async function generateRecap(book, summaries, type, progress) {
  const client = getAI()
  if (!client) return mockRecap(type, book?.title)

  const pct     = Math.round(progress || 0)
  const context = summaries.map(s => s.summary).join('\n\n')
  let prompt

  if (summaries.length === 0) {
    prompt = type === 'chapter'
      ? `The reader is ${pct}% through "${book?.title}" by ${book?.author || 'the author'}. Write a complete 2-3 sentence recap of what typically happens in the first ${pct}% of this book. Do not spoil events past ${pct}%. Finish every sentence completely. Plain text only.`
      : `Give a complete "story so far" description for "${book?.title}" by ${book?.author || 'the author'} for a reader who is ${pct}% through. Write 3-4 full sentences. Do not spoil events past ${pct}%. Plain text only.`
  } else {
    prompt = type === 'chapter'
      ? `Based on these chapter notes from "${book?.title}", write a complete 2-3 sentence recap of the most recent events. Reader is at ${pct}%. Finish every sentence.\n\n${context}`
      : `Based on these chapter notes from "${book?.title}", write a complete 3-4 sentence "story so far" summary for a reader at ${pct}%. Finish every sentence.\n\n${context}`
  }

  try {
    const text = await generateText(prompt, { maxTokens: 600, temperature: 0.6 })
    if (text) return text.trim()
  } catch (err) {
    console.error('Gemini recap error:', err.message)
  }
  return mockRecap(type, book?.title)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildPrompt(action, text) {
  const ex = text.slice(0, 600)
  switch (action) {
    case 'explain':   return `Explain this passage clearly and completely:\n\n"${ex}"`
    case 'summarize': return `Summarize the key points of this passage. Complete every sentence:\n\n"${ex}"`
    case 'define':    return `Clarify difficult terms and allusions in this passage completely:\n\n"${ex}"`
    default:          return `Provide context and insights about this passage:\n\n"${ex}"`
  }
}

function mockResponse(action) {
  switch (action) {
    case 'explain':   return 'This passage explores themes of identity and transformation using vivid imagery to convey the character\'s inner state.'
    case 'summarize': return 'This passage marks a pivotal shift. The protagonist faces an implicit choice that will resonate through subsequent chapters.'
    case 'define':    return 'The language draws on literary allusions that add authenticity and reinforce the work\'s central themes.'
    default:          return 'This passage rewards close reading. The subtext suggests tension between what is stated and what is felt beneath the surface.'
  }
}
function mockChatResponse() {
  return 'AI service temporarily unavailable. Please check your GEMINI_API_KEY and try again.'
}
function mockRecap(type, title) {
  return type === 'chapter'
    ? 'In the most recent section, the protagonist faces a critical decision that tests their resolve and shapes the path forward.'
    : `So far in "${title || 'the book'}", the protagonist navigates a series of challenges that fundamentally shape their character and relationships.`
}
function hashStr(str) {
  let h = 0
  for (let i = 0; i < Math.min(str.length, 200); i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0 }
  return Math.abs(h).toString(36)
}

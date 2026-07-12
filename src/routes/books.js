import { Router }  from 'express'
import prisma      from '../db/prisma.js'
import { authenticate } from '../middleware/auth.js'
import { cacheGet, cacheSet } from '../config/redis.js'
import { generateRecap } from '../controllers/aiController.js'

const router = Router()
router.use(authenticate)

// ── POST /api/books — register book metadata ──────────────────────────────────
router.post('/', async (req, res) => {
  const { bookId, title, author, coverUrl } = req.body
  if (!bookId || !title) return res.status(400).json({ error: 'bookId and title required' })
  try {
    const book = await prisma.book.upsert({
      where:  { id: bookId },
      update: { title, author: author ?? null },
      create: { id: bookId, userId: req.user.id, title, author: author ?? null, coverUrl: coverUrl ?? null },
    })
    res.status(201).json(book)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to register book' })
  }
})

// ── GET /api/books — all user books sorted by lastReadAt desc ─────────────────
// Returns only metadata — NO epub file content.
// lastReadAt drives cross-device order: most recently read always appears first
// on every device. Falls back to createdAt for unread books.
router.get('/', async (req, res) => {
  try {
    const books = await prisma.book.findMany({
      where:   { userId: req.user.id },
      include: {
        readingProgress: {
          where: { userId: req.user.id },
          take:  1,
        },
      },
      // Sort: books with lastReadAt first (most recent), then unread by createdAt
      orderBy: [
        { lastReadAt: { sort: 'desc', nulls: 'last' } },
        { createdAt:  'desc' },
      ],
    })

    const shaped = books.map(b => ({
      id:          b.id,
      title:       b.title,
      author:      b.author,
      coverUrl:    b.coverUrl,
      cloudSynced: b.cloudSynced,
      lastReadAt:  b.lastReadAt,
      createdAt:   b.createdAt,
      percentage:  b.readingProgress[0]?.percentage ?? 0,
      cfi:         b.readingProgress[0]?.cfi ?? null,
      last_read:   b.readingProgress[0]?.updatedAt ?? null,
    }))

    res.json(shaped)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch books' })
  }
})

// ── GET /api/books/:bookId/progress ───────────────────────────────────────────
router.get('/:bookId/progress', async (req, res) => {
  try {
    const progress = await prisma.readingProgress.findUnique({
      where: { userId_bookId: { userId: req.user.id, bookId: req.params.bookId } },
    })
    res.json(progress ?? null)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch progress' })
  }
})

// ── POST /api/books/:bookId/progress ──────────────────────────────────────────
// Also updates lastReadAt on the book — drives library sort order across devices
router.post('/:bookId/progress', async (req, res) => {
  const { cfi, percentage } = req.body
  if (!cfi) return res.status(400).json({ error: 'cfi required' })
  try {
    const [progress] = await prisma.$transaction([
      prisma.readingProgress.upsert({
        where:  { userId_bookId: { userId: req.user.id, bookId: req.params.bookId } },
        update: { cfi, percentage: percentage ?? 0 },
        create: { userId: req.user.id, bookId: req.params.bookId, cfi, percentage: percentage ?? 0 },
      }),
      // Update lastReadAt so this book floats to top of library on all devices
      prisma.book.updateMany({
        where: { id: req.params.bookId, userId: req.user.id },
        data:  { lastReadAt: new Date() },
      }),
    ])
    res.json(progress)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to save progress' })
  }
})

// ── GET /api/books/:bookId/highlights ─────────────────────────────────────────
router.get('/:bookId/highlights', async (req, res) => {
  try {
    const highlights = await prisma.highlight.findMany({
      where:   { userId: req.user.id, bookId: req.params.bookId },
      orderBy: { createdAt: 'desc' },
    })
    res.json(highlights)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch highlights' })
  }
})

// ── POST /api/books/:bookId/highlights ────────────────────────────────────────
router.post('/:bookId/highlights', async (req, res) => {
  const { cfi, text, note, color } = req.body
  if (!cfi || !text) return res.status(400).json({ error: 'cfi and text required' })

  try {
    const highlight = await prisma.highlight.create({
      data: {
        userId: req.user.id,
        bookId: req.params.bookId,
        cfi, text,
        note:  note  ?? null,
        color: color ?? '#E8A83866',
      },
    })
    res.status(201).json(highlight)
  } catch (err) {
    res.status(500).json({ error: 'Failed to save highlight' })
  }
})

// ── DELETE /api/books/:bookId/highlights/:id ──────────────────────────────────
router.delete('/:bookId/highlights/:id', async (req, res) => {
  try {
    await prisma.highlight.deleteMany({
      where: { id: req.params.id, userId: req.user.id },
    })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete highlight' })
  }
})

// ── GET /api/books/:bookId/summaries ──────────────────────────────────────────
router.get('/:bookId/summaries', async (req, res) => {
  try {
    const summaries = await prisma.chapterSummary.findMany({
      where:   { bookId: req.params.bookId },
      orderBy: { createdAt: 'asc' },
    })
    res.json(summaries)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summaries' })
  }
})

// ── POST /api/books/:bookId/summaries ─────────────────────────────────────────
router.post('/:bookId/summaries', async (req, res) => {
  const { chapterCfi, summary } = req.body
  if (!chapterCfi || !summary) return res.status(400).json({ error: 'chapterCfi and summary required' })

  try {
    const saved = await prisma.chapterSummary.upsert({
      where:  { bookId_chapterCfi: { bookId: req.params.bookId, chapterCfi } },
      update: { summary },
      create: { bookId: req.params.bookId, chapterCfi, summary },
    })
    res.status(201).json(saved)
  } catch (err) {
    res.status(500).json({ error: 'Failed to save summary' })
  }
})

// ── POST /api/books/:bookId/recap ─────────────────────────────────────────────
router.post('/:bookId/recap', async (req, res) => {
  const { cfi, progress } = req.body
  const bucket   = Math.floor((progress || 0) / 5) * 5
  const cacheKey = `recap:${req.params.bookId}:${bucket}`

  const cached = await cacheGet(cacheKey)
  if (cached) return res.json(cached)

  try {
    const [summaries, book] = await Promise.all([
      prisma.chapterSummary.findMany({
        where:   { bookId: req.params.bookId },
        orderBy: { createdAt: 'asc' },
        take:    10,
        select:  { summary: true },
      }),
      prisma.book.findFirst({
        where:  { id: req.params.bookId, userId: req.user.id },
        select: { title: true, author: true },
      }),
    ])

    // Generate recap using Gemini with whatever context is available.
    // If no stored summaries, ask Gemini to describe the book up to the reading progress.
    const chapterRecap = await generateRecap(book, summaries, 'chapter', progress)
    const overallRecap = summaries.length > 0
      ? await generateRecap(book, summaries, 'overall', progress)
      : ''

    const result = { chapter: chapterRecap, overall: overallRecap }
    await cacheSet(cacheKey, result, 86400)
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to generate recap' })
  }
})

export default router

import { Router }    from 'express'
import rateLimit     from 'express-rate-limit'
import prisma        from '../db/prisma.js'
import { authenticate }  from '../middleware/auth.js'
import { handleQuery, handleImagine } from '../controllers/aiController.js'

const router = Router()

const aiLimiter = rateLimit({
  windowMs: 60_000,
  max:      30,
  message:  { error: 'Too many AI requests.' },
})

router.use(authenticate)
router.use(aiLimiter)

// POST /api/ai/query
router.post('/query', async (req, res) => {
  const { text, bookId, cfi, action, progress } = req.body
  if (!text?.trim())      return res.status(400).json({ error: 'text required' })
  if (text.length > 2000) return res.status(400).json({ error: 'text too long' })

  try {
    const result = await handleQuery({
      text, bookId, cfi,
      action:   action || 'explain',
      progress: progress || 0,
    })

    // Fire-and-forget persistence
    if (bookId) {
      prisma.aiChat.create({
        data: {
          userId:    req.user.id,
          bookId,
          cfi:       cfi    || null,
          action:    action || 'explain',
          queryText: text,
          response:  result.response,
        },
      }).catch(() => {})
    }

    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'AI query failed' })
  }
})

// POST /api/ai/imagine
router.post('/imagine', async (req, res) => {
  const { text, bookId, progress } = req.body
  if (!text?.trim()) return res.status(400).json({ error: 'text required' })

  try {
    let bookTitle = ''
    if (bookId) {
      const book = await prisma.book.findFirst({
        where:  { id: bookId, userId: req.user.id },
        select: { title: true },
      })
      bookTitle = book?.title ?? ''
    }

    const result = await handleImagine({ text, bookId, bookTitle, progress: progress || 0 })
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Imagine failed' })
  }
})

export default router

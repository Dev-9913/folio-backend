import { Router }  from 'express'
import prisma      from '../db/prisma.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()
router.use(authenticate)

// GET /api/highlights/count
router.get('/count', async (req, res) => {
  try {
    const count = await prisma.highlight.count({ where: { userId: req.user.id } })
    res.json({ count })
  } catch (err) {
    res.status(500).json({ error: 'Failed to count highlights' })
  }
})

// GET /api/highlights
router.get('/', async (req, res) => {
  try {
    const highlights = await prisma.highlight.findMany({
      where:   { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take:    100,
      include: { book: { select: { title: true } } },
    })

    const shaped = highlights.map(h => ({
      ...h,
      bookTitle: h.book.title,
      book:      undefined,
    }))

    res.json(shaped)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch highlights' })
  }
})

export default router

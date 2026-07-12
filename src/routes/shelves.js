import { Router }  from 'express'
import prisma      from '../db/prisma.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()
router.use(authenticate)

const shapeShelf = (shelf) => ({
  id:        shelf.id,
  userId:    shelf.userId,
  name:      shelf.name,
  createdAt: shelf.createdAt,
  bookIds:   shelf.shelfBooks.map(sb => sb.bookId),
})

// GET /api/shelves
router.get('/', async (req, res) => {
  try {
    const shelves = await prisma.shelf.findMany({
      where:   { userId: req.user.id },
      orderBy: { createdAt: 'asc' },
      include: { shelfBooks: { select: { bookId: true } } },
    })
    res.json(shelves.map(shapeShelf))
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch shelves' })
  }
})

// POST /api/shelves
router.post('/', async (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Shelf name required' })

  try {
    const shelf = await prisma.shelf.create({
      data:    { userId: req.user.id, name: name.trim() },
      include: { shelfBooks: { select: { bookId: true } } },
    })
    res.status(201).json(shapeShelf(shelf))
  } catch (err) {
    res.status(500).json({ error: 'Failed to create shelf' })
  }
})

// PATCH /api/shelves/:id
router.patch('/:id', async (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Shelf name required' })

  try {
    const result = await prisma.shelf.updateMany({
      where: { id: req.params.id, userId: req.user.id },
      data:  { name: name.trim() },
    })
    if (result.count === 0) return res.status(404).json({ error: 'Shelf not found' })

    const updated = await prisma.shelf.findUnique({
      where:   { id: req.params.id },
      include: { shelfBooks: { select: { bookId: true } } },
    })
    res.json(shapeShelf(updated))
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename shelf' })
  }
})

// DELETE /api/shelves/:id
router.delete('/:id', async (req, res) => {
  try {
    await prisma.shelf.deleteMany({ where: { id: req.params.id, userId: req.user.id } })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete shelf' })
  }
})

// POST /api/shelves/:id/add-book
router.post('/:id/add-book', async (req, res) => {
  const { bookId } = req.body
  if (!bookId) return res.status(400).json({ error: 'bookId required' })

  try {
    const shelf = await prisma.shelf.findFirst({ where: { id: req.params.id, userId: req.user.id } })
    if (!shelf) return res.status(404).json({ error: 'Shelf not found' })

    await prisma.shelfBook.createMany({
      data:           [{ shelfId: req.params.id, bookId }],
      skipDuplicates: true,
    })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to add book to shelf' })
  }
})

// DELETE /api/shelves/:id/remove-book
router.delete('/:id/remove-book', async (req, res) => {
  const { bookId } = req.body
  if (!bookId) return res.status(400).json({ error: 'bookId required' })

  try {
    await prisma.shelfBook.deleteMany({ where: { shelfId: req.params.id, bookId } })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove book from shelf' })
  }
})

export default router

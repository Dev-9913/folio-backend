import { Router }  from 'express'
import prisma      from '../db/prisma.js'
import { authenticate } from '../middleware/auth.js'
import { handleChat }   from '../controllers/aiController.js'

const router = Router()
router.use(authenticate)

// GET /api/chats?bookId=
router.get('/', async (req, res) => {
  const { bookId } = req.query
  if (!bookId) return res.status(400).json({ error: 'bookId required' })

  try {
    const sessions = await prisma.chatSession.findMany({
      where:   { userId: req.user.id, bookId },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take:    1,
          select:  { content: true },
        },
      },
    })

    const shaped = sessions.map(s => ({
      id:           s.id,
      userId:       s.userId,
      bookId:       s.bookId,
      title:        s.title,
      createdAt:    s.createdAt,
      updatedAt:    s.updatedAt,
      last_message: s.messages[0]?.content?.slice(0, 60) ?? null,
    }))

    res.json(shaped)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch chat sessions' })
  }
})

// POST /api/chats
router.post('/', async (req, res) => {
  const { bookId, title } = req.body
  if (!bookId) return res.status(400).json({ error: 'bookId required' })

  try {
    const session = await prisma.chatSession.create({
      data: { userId: req.user.id, bookId, title: title || 'New Chat' },
    })
    res.status(201).json(session)
  } catch (err) {
    res.status(500).json({ error: 'Failed to create session' })
  }
})

// GET /api/chats/:id/messages
router.get('/:id/messages', async (req, res) => {
  try {
    const session = await prisma.chatSession.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    })
    if (!session) return res.status(404).json({ error: 'Session not found' })

    const messages = await prisma.chatMessage.findMany({
      where:   { sessionId: req.params.id },
      orderBy: { createdAt: 'asc' },
    })
    res.json(messages)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' })
  }
})

// POST /api/chats/:id/messages
router.post('/:id/messages', async (req, res) => {
  const { content, bookId } = req.body
  if (!content?.trim()) return res.status(400).json({ error: 'content required' })

  try {
    const session = await prisma.chatSession.findFirst({
      where:   { id: req.params.id, userId: req.user.id },
      include: { book: { select: { title: true } } },
    })
    if (!session) return res.status(404).json({ error: 'Session not found' })

    const history = await prisma.chatMessage.findMany({
      where:   { sessionId: req.params.id },
      orderBy: { createdAt: 'asc' },
      take:    20,
      select:  { role: true, content: true },
    })

    let progress = 0
    if (session.bookId) {
      const prog = await prisma.readingProgress.findUnique({
        where:  { userId_bookId: { userId: req.user.id, bookId: session.bookId } },
        select: { percentage: true },
      })
      progress = Number(prog?.percentage ?? 0)
    }

    const userMsg = await prisma.chatMessage.create({
      data: { sessionId: req.params.id, role: 'user', content: content.trim() },
    })

    const aiResult = await handleChat({
      message:   content.trim(),
      history,
      bookId:    session.bookId,
      bookTitle: session.book?.title,
      progress,
    })

    const [aiMsg] = await prisma.$transaction([
      prisma.chatMessage.create({
        data: { sessionId: req.params.id, role: 'assistant', content: aiResult.content },
      }),
      prisma.chatSession.update({
        where: { id: req.params.id },
        data:  { updatedAt: new Date() },
      }),
    ])

    res.json({ ...aiMsg, userMessageId: userMsg.id })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to send message' })
  }
})

// DELETE /api/chats/:id
router.delete('/:id', async (req, res) => {
  try {
    await prisma.chatSession.deleteMany({ where: { id: req.params.id, userId: req.user.id } })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete session' })
  }
})

export default router

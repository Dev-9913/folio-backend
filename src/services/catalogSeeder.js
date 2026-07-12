import { load } from 'cheerio'
import crypto    from 'crypto'
import prisma    from '../db/prisma.js'

const SE_BASE          = 'https://standardebooks.org'
const SCRAPE_DELAY_MS   = 800           // polite delay between page requests
const STALE_AFTER_MS    = 7 * 24 * 60 * 60 * 1000  // 7 days — industry standard
                                                     // for a slow-moving public
                                                     // domain catalog (SE adds
                                                     // ~2-3 books/month)
const FEATURED_PAGE_SIZE = 48

// Fixed list of SE subjects — taken directly from the <select> on /ebooks.
// These are stable; SE adds subjects extremely rarely.
// Keys = URL slug used in ?tags[]=, values = display name stored in DB.
const SE_SUBJECTS = {
  'adventure':      'Adventure',
  'autobiography':  'Autobiography',
  'biography':      'Biography',
  'childrens':      "Children's",
  'comedy':         'Comedy',
  'drama':          'Drama',
  'fantasy':        'Fantasy',
  'fiction':        'Fiction',
  'horror':         'Horror',
  'memoir':         'Memoir',
  'mystery':        'Mystery',
  'nonfiction':     'Nonfiction',
  'philosophy':     'Philosophy',
  'poetry':         'Poetry',
  'satire':         'Satire',
  'science-fiction':'Science Fiction',
  'shorts':         'Shorts',
  'spirituality':   'Spirituality',
  'travel':         'Travel',
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── Network readiness check ───────────────────────────────────────────────────
// Docker containers sometimes start before DNS/routing is ready.
// Probe SE with a lightweight HEAD request, retry up to 5 times with backoff.
// This prevents the "fetch failed" crash on first boot.
async function waitForNetwork(maxAttempts = 5) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      // GET a tiny page — any HTTP response means DNS + network are ready
      // Don't check res.ok — a 403/429 from Cloudflare still proves reachability
      await fetch(`${SE_BASE}/ebooks?page=1&per-page=1&view=grid`, {
        headers: { 'User-Agent': 'Folio/1.0', 'Accept': 'text/html' },
        signal: AbortSignal.timeout(10000),
      })
      console.log(`[Catalog] Network ready`)
      return true
    } catch (e) {
      const delay = Math.pow(2, i) * 3000 // 3s, 6s, 12s, 24s, 48s
      console.warn(`[Catalog] Network not ready (attempt ${i + 1}/${maxAttempts}): ${e.message} — retrying in ${delay/1000}s…`)
      await sleep(delay)
    }
  }
  throw new Error('Network unavailable after 5 attempts — SE unreachable')
}

// ── Single page scrape ────────────────────────────────────────────────────────
async function scrapePage(page, sort = 'default') {
  const url = `${SE_BASE}/ebooks?page=${page}&sort=${sort}&per-page=${FEATURED_PAGE_SIZE}&view=grid`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Folio/1.0 (reading app; respectful scraper)', 'Accept': 'text/html' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`SE HTTP ${res.status} on page ${page} (sort=${sort})`)

  const html = await res.text()
  const $    = load(html)
  const books = []

  $('ol.ebooks-list li[about]').each((_, el) => {
    try {
      // Slug — taken directly from the [about] attribute, most reliable source
      const about = $(el).attr('about') || ''
      const slug  = about.replace(/^\/ebooks\//, '').replace(/\/$/, '')
      if (!slug || slug.split('/').length < 2) return

      // Title — first span[property="schema:name"] (before the author paragraph)
      const title = $(el).find('span[property="schema:name"]').first().text().trim()
      if (!title) return

      // Author — span[property="schema:name"] inside p.author specifically
      const author = $(el).find('p.author span[property="schema:name"]').first().text().trim()
      if (!author) return

      // Cover — SE exposes a permanent /downloads/cover.jpg at every book's
      // URL. This is more reliable than scraping the listing-page <img> src
      // which includes a content-hash (e.g. "dfa4d751") that could change if
      // SE regenerates the cover. The /downloads/cover.jpg path is stable
      // forever and requires no additional network request to discover.
      // Confirmed via og:image meta tag on every SE book detail page.
      const coverUrl = `${SE_BASE}/ebooks/${slug}/downloads/cover.jpg`

      // EPUB download URL — deterministic pattern confirmed via SE website:
      // /ebooks/{author}/{title}/downloads/{author}_{title}.epub
      // For translated works: /ebooks/{author}/{title}/{translator}/downloads/...
      const epubFile = slug.split('/').join('_') + '.epub'
      const epubUrl  = `${SE_BASE}/ebooks/${slug}/downloads/${epubFile}`

      books.push({ id: slug, title, author, coverUrl, epubUrl })
    } catch {
      // skip malformed entries silently
    }
  })

  // Two signals for "has next page":
  // 1. rel="next" link — SE includes this on all pages except the last
  // 2. Fallback: scan numbered pagination links for a page number > current
  const hasNextLink = $('a[rel="next"]').length > 0

  let maxPage = page
  $('a[href*="page="]').each((_, el) => {
    const m = ($(el).attr('href') || '').match(/[?&]page=(\d+)/)
    if (m) maxPage = Math.max(maxPage, Number(m[1]))
  })

  return { books, hasNext: hasNextLink || maxPage > page, maxPage }
}

// ── Scrape full catalog (default sort, all pages) ────────────────────────────
async function scrapeFullCatalog() {
  console.log('[Catalog] Scraping full catalog (default sort)…')
  const all = []
  let page = 1, hasNext = true, safetyLimit = 100
  while (hasNext && safetyLimit-- > 0) {
    const result = await scrapePage(page, 'default')
    all.push(...result.books)
    hasNext = result.hasNext
    console.log(`[Catalog]   page ${page}: +${result.books.length} (total ${all.length})`)
    page++
    if (hasNext) await sleep(SCRAPE_DELAY_MS)
  }

  return all
}

// ── Scrape just page 1 of a given sort — for featured rails ──────────────────
async function scrapeFeaturedPage(sort) {
  console.log(`[Catalog] Scraping featured page (sort=${sort})…`)
  const { books } = await scrapePage(1, sort)
  return books // already in rank order — index 0 is rank 1
}

// ── Deterministic paywall assignment ──────────────────────────────────────────
// Same slug always produces the same isPaid/price, independent of scrape order
// or re-runs. ~30% paid, rest free. Test-mode price fixed at ₹1 (100 paise).
function assignPricing(slug) {
  const hash   = crypto.createHash('md5').update(slug).digest('hex')
  const bucket = parseInt(hash.slice(0, 4), 16) % 10
  const isPaid = bucket < 3
  return { isPaid, pricePaise: isPaid ? 100 : 0 }
}
// ── Scrape all slugs for one subject tag ─────────────────────────────────────
// Uses the same ebooks listing page with tags[] filter — reuses existing
// parsing logic, no new selectors needed.
async function scrapeSubjectSlugs(subjectKey) {
  const slugs = []
  let page = 1, hasNext = true, safety = 60
  while (hasNext && safety-- > 0) {
    const url = `${SE_BASE}/ebooks?tags[]=${subjectKey}&per-page=48&page=${page}`

    // Retry each page up to 3 times with exponential backoff.
    // On Fiction page 14 timing out, the old code broke and lost 200+ books.
    // Now we retry with 2s → 4s → 8s delays before giving up on that page.
    let lastErr = null
    let pageSucceeded = false
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          console.warn(`[Catalog]   subject ${subjectKey} page ${page} retry ${attempt}…`)
          await sleep(2000 * Math.pow(2, attempt - 1))
        }
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Folio/1.0', 'Accept': 'text/html' },
          signal: AbortSignal.timeout(20000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const $ = load(await res.text())
        $('ol.ebooks-list li[about]').each((_, el) => {
          const slug = ($(el).attr('about') || '').replace(/^\/ebooks\//, '').replace(/\/$/, '')
          if (slug && slug.split('/').length >= 2) slugs.push(slug)
        })
        hasNext = $('a[rel="next"]').length > 0
        page++
        if (hasNext) await sleep(SCRAPE_DELAY_MS)
        pageSucceeded = true
        break
      } catch (err) { lastErr = err }
    }
    if (!pageSucceeded) {
      console.warn(`[Catalog]   subject ${subjectKey} page ${page} failed after 3 attempts (${lastErr?.message}) — skipping`)
      page++
      hasNext = false
    }
  }
  return slugs
}

// ── Scrape all 19 subjects, build slug→subjects map, bulk UPDATE DB ───────────
// Runs 3 subjects in parallel to keep total time under ~60s.
async function scrapeAndApplySubjects() {
  console.log('[Catalog] Scraping subjects (19 tags, 3 parallel)…')

  const subjectEntries = Object.entries(SE_SUBJECTS)
  // Map of bookSlug → Set of display-name subjects
  const subjectMap = new Map()

  // Process in chunks of 3 parallel requests
  const PARALLEL = 3
  for (let i = 0; i < subjectEntries.length; i += PARALLEL) {
    await Promise.all(subjectEntries.slice(i, i + PARALLEL).map(async ([key, displayName]) => {
      const slugs = await scrapeSubjectSlugs(key)
      slugs.forEach(slug => {
        if (!subjectMap.has(slug)) subjectMap.set(slug, new Set())
        subjectMap.get(slug).add(displayName)
      })
      console.log(`[Catalog]   ${displayName}: ${slugs.length} books`)
    }))
  }

  console.log(`[Catalog] Applying subjects to ${subjectMap.size} books…`)

  // Only update rows that actually have subjects — skip books with empty
  // subject sets (means their subject scrape failed). This preserves any
  // existing subject data from a previous successful scrape on those books.
  const rows = Array.from(subjectMap.entries())
    .filter(([, s]) => s.size > 0)
    .map(([slug, s]) => ({ slug, subjects: Array.from(s).sort() }))

  if (rows.length === 0) {
    console.warn('[Catalog] No subjects to apply — all subject scrapes may have failed')
    return
  }

  const CHUNK = 400
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)

    const valuesList = chunk.map(({ slug, subjects }) => {
      const escapedSlug = slug.replace(/'/g, "''")
      const pgArray = `ARRAY[${subjects.map(s => `'${s.replace(/'/g, "''")}'`).join(',')}]::text[]`
      return `('${escapedSlug}', ${pgArray})`
    }).join(',')

    await prisma.$executeRawUnsafe(`
      UPDATE catalog_books AS cb
      SET    subjects = v.subjects
      FROM   (VALUES ${valuesList}) AS v(id, subjects)
      WHERE  cb.id = v.id
    `)
  }

  console.log(`[Catalog] Subjects applied to ${rows.length} books`)
}

// ── Main entry: seed or refresh the catalog ──────────────────────────────────
// `force = true` skips the staleness check (used by the manual refresh route).
export async function seedCatalog({ force = false } = {}) {
  try {
    const meta = await prisma.catalogMeta.findUnique({ where: { id: 1 } })

    const isStale = !meta || (Date.now() - new Date(meta.lastScraped).getTime() > STALE_AFTER_MS)

    if (!force && !isStale) {
      console.log(`[Catalog] Fresh (last scraped ${meta.lastScraped.toISOString()}) — skipping`)
      return { skipped: true, bookCount: meta.bookCount }
    }

    console.log(force ? '[Catalog] Forced refresh starting…' : '[Catalog] Stale — refreshing…')

    // Wait for Docker network to be ready before hitting SE
    await waitForNetwork()

    const [fullCatalog, popularBooks, newBooks] = await Promise.all([
      scrapeFullCatalog(),
      scrapeFeaturedPage('popularity'),
      scrapeFeaturedPage('default'),
    ])

    // Failsafe — if scrape returns drastically fewer books than expected,
    // the site is probably blocking us. Keep existing data.
    const prevCount = meta?.bookCount ?? 0
    const minExpected = prevCount > 0 ? Math.floor(prevCount * 0.85) : 100
    if (fullCatalog.length < minExpected) {
      console.error(`[Catalog] Failsafe: got ${fullCatalog.length} books, expected ≥${minExpected}. Keeping existing catalog.`)
      return { error: `Scrape too small (${fullCatalog.length}/${minExpected})`, bookCount: prevCount }
    }

    // Build rank lookup maps
    const popularityRankBySlug = new Map(popularBooks.map((b, i) => [b.id, i + 1]))
    const releaseRankBySlug    = new Map(newBooks.map((b, i) => [b.id, i + 1]))

    // Dedupe full catalog by slug (defensive — pagination could theoretically overlap)
    const seen = new Set()
    const deduped = fullCatalog.filter(b => { if (seen.has(b.id)) return false; seen.add(b.id); return true })

    const batchId = new Date().toISOString()

    const rows = deduped.map(b => {
      const { isPaid, pricePaise } = assignPricing(b.id)
      return {
        id: b.id, title: b.title, author: b.author,
        coverUrl: b.coverUrl, epubUrl: b.epubUrl,
        subjects: [], description: null,
        isPaid, pricePaise,
        popularityRank: popularityRankBySlug.get(b.id) ?? null,
        releaseRank:    releaseRankBySlug.get(b.id)    ?? null,
        scrapeBatch:    batchId,
      }
    })

    // ── Upsert via raw SQL INSERT ... ON CONFLICT DO UPDATE ─────────────────────
    // Uses one DB connection per chunk of 100 rows — avoids pool exhaustion.
    // ON CONFLICT preserves description + subjects (scrapped separately) while
    // updating catalog fields and crucially the scrapeBatch (marks book as current
    // so the subsequent deleteMany doesn't remove it as "stale").
    console.log(`[Catalog] Upserting ${rows.length} books (batch ${batchId})…`)
    const UPSERT_CHUNK = 100
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK)
      const esc   = (s) => (s || '').replace(/'/g, "''")

      const valuesList = chunk.map(r => {
        const popR = (r.popularityRank != null) ? r.popularityRank : 'NULL'
        const relR = (r.releaseRank    != null) ? r.releaseRank    : 'NULL'
        return (
          `('${esc(r.id)}','${esc(r.title)}','${esc(r.author)}',` +
          `'${esc(r.coverUrl)}','${esc(r.epubUrl)}',` +
          `${r.isPaid},${r.pricePaise},` +
          `${popR},${relR},` +
          `'${esc(r.scrapeBatch)}',ARRAY[]::text[],NOW())`
        )
      }).join(',')

      await prisma.$executeRawUnsafe(`
        INSERT INTO catalog_books
          (id,title,author,cover_url,epub_url,is_paid,price_paise,
           popularity_rank,release_rank,scrape_batch,subjects,created_at)
        VALUES ${valuesList}
        ON CONFLICT (id) DO UPDATE SET
          title=EXCLUDED.title, author=EXCLUDED.author,
          cover_url=EXCLUDED.cover_url, epub_url=EXCLUDED.epub_url,
          is_paid=EXCLUDED.is_paid, price_paise=EXCLUDED.price_paise,
          popularity_rank=EXCLUDED.popularity_rank,
          release_rank=EXCLUDED.release_rank,
          scrape_batch=EXCLUDED.scrape_batch
      `)
    }

    const deleted = await prisma.catalogBook.deleteMany({
      where: { scrapeBatch: { not: batchId } },
    })
    console.log(`[Catalog] Swap complete — removed ${deleted.count} stale rows`)

    await prisma.catalogMeta.upsert({
      where:  { id: 1 },
      update: { lastScraped: new Date(), bookCount: rows.length, currentBatch: batchId },
      create: { id: 1, lastScraped: new Date(), bookCount: rows.length, currentBatch: batchId },
    })

    // Subjects are not on the listing pages — scrape them separately
    // via the ?tags[] filter. Runs after the atomic swap so it updates
    // the already-live rows; a failure here is non-fatal.
    try {
      await scrapeAndApplySubjects()
    } catch (err) {
      console.warn('[Catalog] Subject scrape failed (catalog still live):', err.message)
    }

    console.log(`[Catalog] Done — ${rows.length} books live`)
    return { skipped: false, bookCount: rows.length }

  } catch (err) {
    console.error('[Catalog] Seed failed:', err.message)
    // Never throw — a failed scrape should never crash server startup or
    // wipe the existing (still valid) catalog data.
    return { error: err.message }
  }
}

// Exposed separately so the manual refresh route can call it explicitly
export async function forceRefresh() {
  return seedCatalog({ force: true })
}

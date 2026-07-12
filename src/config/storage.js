import supabase from './supabase.js'

const BUCKET = 'epubs'

// Upload EPUB buffer to Supabase Storage
export async function uploadEpub(bookId, buffer, mimeType = 'application/epub+zip') {
  const path = `${bookId}.epub`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: mimeType,
      upsert: true,
    })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
  return path
}

// Get a signed URL valid for 1 hour
export async function getSignedUrl(bookId) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(`${bookId}.epub`, 3600)
  if (error) throw new Error(`Signed URL failed: ${error.message}`)
  return data.signedUrl
}

// Download EPUB from Supabase Storage as a buffer
export async function downloadEpub(bookId) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(`${bookId}.epub`)
  if (error) throw new Error(`Storage download failed: ${error.message}`)
  const arrayBuffer = await data.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// Delete EPUB from storage
export async function deleteEpub(bookId) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([`${bookId}.epub`])
  if (error) console.warn(`Storage delete warning: ${error.message}`)
}
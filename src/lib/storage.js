// Storage helpers for quote PDFs.
// Uses Supabase Storage with a private bucket (signed URLs for viewing).
// All quote PDFs go into the 'quote-pdfs' bucket, namespaced by client.

import { supabase } from './supabase'

const BUCKET = 'quote-pdfs'

// Uploads a PDF file. Returns the storage path on success.
// Path format: <client_id>/<timestamp>-<original_filename>
// Timestamp prefix prevents filename collisions.
export async function uploadQuotePdf(clientId, file) {
  if (!file) return null
  const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
  const path = `${clientId}/${Date.now()}-${safeName}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/pdf',
    })

  if (error) throw error
  return path
}

// Generates a temporary signed URL (60 min) for viewing a PDF.
// We don't store signed URLs — they expire. We store the storage path
// and generate a fresh signed URL each time the user clicks "View PDF."
export async function getQuotePdfSignedUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

// Deletes a PDF from storage. Used when deleting a quote.
export async function deleteQuotePdf(path) {
  if (!path) return
  await supabase.storage.from(BUCKET).remove([path])
}

// ---- Document Hub (per-client files by category) ----
// Reuses the same private bucket, namespaced by client + category:
//   <clientId>/<category>/<timestamp>-<filename>
// category ∈ 'quote' | 'contract' | 'rendering'

export async function uploadClientDoc(clientId, category, file) {
  const safe = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
  const path = `${clientId}/${category}/${Date.now()}-${safe}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined })
  if (error) throw error
  return path
}

export async function listClientDocs(clientId, category) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(`${clientId}/${category}`, { sortBy: { column: 'created_at', order: 'desc' } })
  if (error) throw error
  return (data ?? [])
    .filter(f => f.name && f.name !== '.emptyFolderPlaceholder')
    .map(f => ({
      name: f.name,
      path: `${clientId}/${category}/${f.name}`,
      label: f.name.replace(/^\d+-/, ''),
      createdAt: f.created_at || f.updated_at || null,
      size: f.metadata?.size ?? null,
    }))
}

export async function getDocSignedUrl(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

export async function deleteDoc(path) {
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw error
  return true
}

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { Readable } from 'node:stream'

import matter from 'gray-matter'
import * as cheerio from 'cheerio'
import { Client as Minio } from 'minio'
import Yaml from 'yaml'

const { S3_BUCKET, S3_CDN_URL } = process.env

function minio() {
  return new Minio({
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    endPoint: process.env.S3_ENDPOINT,
  })
}

/**
  @typedef {object} EmplaceOperation
  @property {Function | undefined} update?
  @property {Function | undefined} insert
*/

/**
  @param {Map<string, any>} map
  @param {string} key
  @param {EmplaceOperation} operation
 */
export function emplace(map, key, operation = {}) {
  const value = map.get(key)
  map.set(
    key,
    value !== undefined
      ? operation.update?.(value, key, map) ?? value
      : operation.insert?.(key, map),
  )
}

export function statusVisitor(userId) {
  const visited = new Set()
  return function* visit(...statuses) {
    for (const status of statuses) {
      if (visited.has(status.id)) return
      if (status.account.id !== userId) return
      if (
        status.in_reply_to_account_id &&
        status.in_reply_to_account_id !== userId
      ) {
        return
      }
      visited.add(status.id)
      yield status
    }
  }
}

/** Takes a status and record of id-statuses and finds the origin parent */
export function getOrigin(status, statuses) {
  let current = status
  while (current?.in_reply_to_id !== null) {
    current = statuses[current.in_reply_to_id]
  }
  return current
}

/** Takes a record of id-status and creates threads */
export function rethread(statuses) {
  const threads = new Map()

  for (const status of Object.values(statuses)) {
    const origin = getOrigin(status, statuses)

    if (!origin) {
      throw new Error('No origin found "' + status.id + '"')
    }
    emplace(threads, origin.id, {
      insert: () => [status],
      update: (arr) => arr.concat(status),
    })
  }

  for (const [key, value] of threads) {
    threads.set(
      key,
      value.sort((a, b) => a.created_at.localeCompare(b.created_at)),
    )
  }
  return threads
}

/**
  @param {string | URL} base
  @returns {Promise<Map<string, { url: URL, content: string, data: any }>>}
*/
export async function loadCollection(base) {
  const files = new Map()
  for (const file of await fs.readdir(base)) {
    if (!file.endsWith('.md')) continue
    const url = new URL(`./${file}`, base)
    const { content = '', data = {} } = matter(await fs.readFile(url, 'utf8'))
    files.set(file, { url, content, data })
  }
  return files
}

/**
  @param {string | URL} base
  @returns {Promise<Map<string, { id: string, content: string, data: any }>>}
*/
export async function loadMedia(base) {
  const files = new Map()

  for (const file of await fs.readdir(base)) {
    if (!file.endsWith('.md')) continue
    const url = new URL(`./${file}`, base)
    const id = file.replace(/\.md$/, '')
    const { content, data } = matter(await fs.readFile(url, 'utf8'))
    files.set(id, { id, content, data })
  }

  return files

  //   // ~ Not sure what to have media IDs set as ATM
  //   const collection = await loadCollection(getDirectoryUrl('content/media'))
  //
  //   const map = new Map()
  //   for (const [filename, media] of collection) {
  //     if (!filename.endsWith('.md')) continue
  //     map.set(filename.replace('.md', ''), media)
  //   }
  //
  //   return map
}

/** @param {Iterable<string>} names */
export function nextPage(names) {
  let largest = -1
  for (const name of names) {
    const base = path.basename(name, path.extname(name))
    const number = parseInt(base)
    if (Number.isNaN(number)) continue
    if (number > largest) largest = number
  }
  return largest === -1 ? 1 : largest + 1
}

export function isRef(page, kind, id) {
  const refs = page.data?.refs?.[kind]
  return Array.isArray(refs) ? refs.includes(id) : false
}

// TODO: needs tests
export function findByRef(map, kind, id) {
  for (const page of map.values()) {
    if (isRef(page, kind, id)) return page
  }
  return null
}

export function emplaceStatus(status, pages, operation = {}) {
  for (const page of pages.values()) {
    if (isRef(page, 'mastodon_status', status.id)) {
      return operation.skip?.(page)
    }
  }
  if (status.in_reply_to_id) {
    for (const page of pages.values()) {
      if (isRef(page, 'mastodon_status', status.in_reply_to_id)) {
        return operation.update?.(page, status)
      }
    }
  }
  return operation.insert?.(status)
}

/**
  @typedef {object} StatusTextOptions
  @property {string[] | undefined} stripUrls
*/

/**
  @param {string} inputText
  @param {StatusTextOptions} options
*/
export function statusText(inputText, options = {}) {
  const $ = cheerio.load(inputText)

  const body = $('body')

  if (options.stripUrls) {
    const urls = new Set(options.stripUrls)

    for (const anchor of body.find('a')) {
      if (urls.has(anchor.attribs.href?.toLocaleLowerCase())) {
        $(anchor).remove()
      }
    }
  }

  // TODO: clean Mastodon invisibles ?

  for (const p of body.find('p')) {
    if (p.children.length === 0) $(p).remove()
  }

  return body.html()
}

export function statusFrontmatter(status) {
  return {
    refs: {
      mastodon_status: [status.id],
    },
    date: new Date(status.created_at),
    media: status.meta?.media ?? undefined,
  }
}

export function statusUrls(status) {
  const urls = []
  if (status.tags) urls.push(...status.tags.map((t) => t.url))
  if (status.card) urls.push(status.card.url)
  return urls.map((u) => u.toLocaleLowerCase())
}

export function getAttachmentMedia(attachment) {
  return {
    data: {
      type: attachment.type,
      original: attachment.url,
      preview: attachment.preview_url,
      width: attachment.meta.original.width,
      height: attachment.meta.original.height,
      blurhash: attachment.blurhash,
      refs: {
        mastodon_media: [attachment.id],
      },
    },
    content: attachment.description,
  }
}

export function getCardMedia(status) {
  return {
    data: {
      type: 'image',
      original: status.card.image,
      width: status.card.width,
      height: status.card.height,
      blurhash: status.card.blurhash,
      refs: {
        mastodon_card: [status.id],
      },
    },
    content: status.card.title,
  }
}

export function parseOpengraph(url, inputText) {
  const $ = cheerio.load(inputText)

  let image = $('meta[property="og:image"]')?.attr('content')
  if (image?.startsWith('/')) {
    image = new URL(image, url).toString()
  }

  return {
    type: $('meta[property="og:type"]')?.attr('content') ?? null,
    title:
      $('meta[name="twitter:title"]')?.attr('content') ??
      $('meta[property="og:title"]')?.attr('content') ??
      $('title')?.text() ??
      null,
    description:
      $('meta[name="twitter:description"]')?.attr('content') ??
      $('meta[property="og:description"]')?.attr('content') ??
      $('meta[name="description"]')?.attr('content') ??
      null,
    url: $('meta[property="og:url"]')?.attr('content') ?? url,
    image: image ?? null,
  }
}

export async function resolveMedia(media) {
  const originalPath = `mastodon/original/${media.id}${path.extname(
    media.data.original,
  )}`

  // Put "original" media into S3
  await putS3Object(originalPath, media.data.original)

  // Rewrite media's "original" URL before writing to file
  media.data.original = new URL('./' + originalPath, S3_CDN_URL).toString()

  if (media.data.preview) {
    const previewPath = `mastodon/preview/${media.id}${path.extname(
      media.data.preview,
    )}`

    // Put "preview" media into S3
    await putS3Object(previewPath, media.data.preview)

    // Rewrite media's "preview" URL before writing to file
    media.data.preview = new URL('./' + previewPath, S3_CDN_URL).toString()
  }
}

export async function putS3Object(key, url) {
  const s3 = minio()

  const stat = await s3.statObject(S3_BUCKET, key).catch(() => null)
  if (stat) {
    console.debug('skip object %o', key, url.toString())
    return false
  }

  const res = await fetch(url)

  if (!res || !res.body) {
    console.error('Failed to download %o', url)
    return false
  }

  // https://docs.digitalocean.com/reference/api/spaces-api/
  await s3.putObject(S3_BUCKET, key, Readable.fromWeb(res.body), {
    'x-amz-acl': 'public-read',
    'Content-Type': res.headers.get('Content-Type'),
    'Content-Length': res.headers.get('Content-Length'),
  })

  return true
}

// The page needs to be re-written each time because the front matter + content change
// TODO: this API could be better
export async function writePage(page) {
  await fs.writeFile(
    page.url,
    ['---', prettyYaml(page.data), '---', '', page.content].join('\n') + '\n',
    'utf8',
  )
}

export function prettyYaml(data) {
  const doc = Yaml.parseDocument(Yaml.stringify(data))

  const refs = doc.get('refs')
  if (refs && Yaml.isCollection(refs)) {
    for (const item of refs.items) {
      if (Yaml.isSeq(item.value)) {
        item.value.flow = true

        for (const id of item.value.items) {
          if (Yaml.isScalar(id)) {
            id.type = 'QUOTE_SINGLE'
          }
        }
      }
    }
  }

  const media = doc.get('media')
  if (media && Yaml.isSeq(media)) {
    media.flow = true
  }

  return doc
    .toString({ singleQuote: true, flowCollectionPadding: false })
    .trim()
}

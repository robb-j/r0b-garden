#!/usr/bin/env node

import 'dotenv/config'

import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { Writable, Readable } from 'node:stream'
import parseLinkHeader from 'parse-link-header'
import Yaml from 'yaml'
import * as Minio from 'minio'

import config from '../config.json' assert { type: 'json' }
import {
  statusVisitor,
  loadCollection,
  nextPage,
  statusText,
  statusUrls,
  statusFrontmatter,
  rethread,
  getAttachmentMedia,
  getCardMedia,
  emplaceStatus,
  parseOpengraph,
  findByRef,
  loadMedia,
} from '../utils.js'

const minio = new Minio.Client({
  accessKey: process.env.S3_ACCESS_KEY,
  secretKey: process.env.S3_SECRET_KEY,
  endPoint: process.env.S3_ENDPOINT,
})

const { S3_BUCKET, S3_CDN_URL } = process.env

const cacheURL = new URL('../.cache/mastodon.json', import.meta.url)

const mastodon = config.mastodon

const headers = new Headers()
if (process.env.MASTODON_TOKEN) {
  headers.set('Authorization', `bearer ${process.env.MASTODON_TOKEN}`)
} else {
  console.error('ERROR: MASTODON_TOKEN not set')
}

//
// === API ===
//

// GET /api/v1/accounts/lookup HTTP/1.1
// https://docs.joinmastodon.org/methods/accounts/#lookup
// https://docs.joinmastodon.org/entities/Account/
async function lookupUser(serverUrl, username) {
  const lookupEndpoint = new URL(`./api/v1/accounts/lookup`, serverUrl)
  lookupEndpoint.searchParams.set('acct', username)

  const lookup = await fetch(lookupEndpoint)
  if (!lookup.ok) throw new Error(`User not found: ${username}`)
  return lookup.json()
}

// TODO: do rate limiting...
async function niceFetch(...args) {
  const res = await fetch(...args)
  // console.log(
  //   res.status,
  //   res.headers.get('X-RateLimit-Limit'),
  //   res.headers.get('X-RateLimit-Remaining'),
  //   res.headers.get('X-RateLimit-Reset'),
  // )
  return res
}

// GET /api/v1/accounts/:id/statuses HTTP/1.1
// https://docs.joinmastodon.org/entities/Status/
async function* iterateEndpoint(endpoint) {
  while (endpoint) {
    const res = await niceFetch(endpoint, { headers })
    if (!res.ok) break

    endpoint = res.headers.has('link')
      ? parseLinkHeader(res.headers.get('link'))?.next?.url
      : null

    yield* await res.json()
  }
}

// GET /api/v1/statuses/:id/context HTTP/1.1
// https://docs.joinmastodon.org/methods/statuses/#context
async function getContext(serverUrl, statusId) {
  const res = await niceFetch(
    new URL(`./api/v1/statuses/${statusId}/context`, serverUrl),
    { headers },
  )
  return res.json()
}

function mkdir(path) {
  return fs.mkdir(path, { recursive: true })
}

const templates = {
  film(status) {
    return {
      content: statusText(status.content, {
        stripUrls: statusUrls(status),
      }),
      data: {
        ...statusFrontmatter(status),
        url: status.card?.url,
        title: status.card?.title,
        blurb: status.card?.description,
      },
    }
  },
  note(status) {
    return {
      content: statusText(status.content, {
        stripUrls: statusUrls(status),
      }),
      data: {
        ...statusFrontmatter(status),
        // TODO: map to "label"'s name ?'
        tags: status.tags
          .filter((t) => t.name !== 'notes')
          .map((t) => `label:${t.name}`),
      },
    }
  },
  photo(status) {
    return {
      content: statusText(status.content, {
        stripUrls: statusUrls(status),
      }),
      data: {
        ...statusFrontmatter(status),
      },
    }
  },
  tune(status) {
    return {
      content: statusText(status.content, {
        stripUrls: statusUrls(status),
      }),
      data: {
        ...statusFrontmatter(status),
        url: status.card?.url,
        title: status.card?.title,
        description: status.card?.description,
        provider: status.card?.provider_name,
      },
    }
  },
}

//
// === MAIN ===
//

async function fetchCard(status) {
  try {
    const res = await fetch(status.card.url)
    if (!res.ok) throw new Error('Failed request: ' + res.statusText)

    const { title, description, image } = parseOpengraph(
      status.card.url,
      await res.text(),
    )

    if (title) status.card.title = title
    if (description) status.card.description = description
    if (image) status.card.image = image

    return true
  } catch (error) {
    console.debug('fetchCard failed', error.message)
    return false
  }
}

function getDirectoryUrl(directory) {
  return new URL(`../${directory}/`, import.meta.url)
}

async function fetchCache(userId) {
  const cache = { statuses: {}, media: {} }

  const allMedia = await loadMedia(getDirectoryUrl('content/media'))

  // Loop through each tag of each content type from config.json
  for (const [template, contentType] of Object.entries(mastodon.types)) {
    for (const tag of contentType.hashtags) {
      console.debug('Searching #%s', tag)

      // Loop through each status for that tag including parents & children
      for await (const status of iterateUserHashtag(userId, tag)) {
        console.debug(' - ' + status.id)

        if (status.card && !status.card.image) {
          console.debug('   fetching %s', status.card.url)
          await fetchCard(status)
        }

        const meta = {
          template,
          media: [],
        }

        // Convert card to media
        if (status.card?.image) {
          let media = findByRef(allMedia, 'mastodon_card', status.id)
          if (!media) {
            media = getCardMedia(status)
            media.id = nextPage(allMedia.keys()).toString()
            allMedia.set(media.id, media)
          }
          meta.media.push(media.id)
        }

        // Convert attachments to media
        for (const attachment of status.media_attachments) {
          let media = findByRef(allMedia, 'mastodon_media', attachment.id)
          if (!media) {
            media = getAttachmentMedia(attachment)
            media.id = nextPage(allMedia.keys()).toString()
            allMedia.set(media.id, media)
          }
          meta.media.push(media.id)
        }

        // Store the status & related template
        cache.statuses[status.id] = { ...status, meta }
      }
    }
  }

  for (const [id, media] of allMedia.entries()) {
    cache.media[id] = media
  }

  cache.threads = Object.fromEntries(rethread(cache.statuses))

  await mkdir(new URL('../.cache', import.meta.url))
  await fs.writeFile(cacheURL, JSON.stringify(cache, null, 2))

  return cache
}

async function emplaceS3Object(key, url) {
  const stat = await minio.statObject(S3_BUCKET, key).catch(() => null)
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
  await minio.putObject(S3_BUCKET, key, Readable.fromWeb(res.body), {
    'x-amz-acl': 'public-read',
    'Content-Type': res.headers.get('Content-Type'),
    'Content-Length': res.headers.get('Content-Length'),
  })

  return true
}

async function processThreads(threads, dryRun) {
  // Pre load collections for each content-type
  const collections = {}
  for (const [template, contentType] of Object.entries(mastodon.types)) {
    const base = getDirectoryUrl(contentType.directory)
    collections[template] = await loadCollection(base)
  }

  // Sort the threads oldest first so older toots have lower identifiers
  const oldestThreads = Object.entries(threads)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map((e) => e[1])

  let skipped = 0

  // Loop through each status in each thread.
  // Oldest toots come first so threads are appended to existing files
  for (const thread of oldestThreads) {
    for (const status of thread) {
      const { template } = status.meta

      const contentType = config.mastodon.types[template]
      const pages = collections[template]

      // Process the status using the related template
      const { content, data } = templates[template](status)

      await emplaceStatus(status, pages, {
        skip: (page) => {
          if (dryRun) {
            console.log('skip status=%o', status.id, page.url)
          }
          skipped++
        },
        insert: async () => {
          // Create page
          const id = nextPage(pages.keys())
          const url = new URL(
            `${id}.md`,
            getDirectoryUrl(contentType.directory),
          )

          // Add page to collection
          const page = { url, content, data }
          pages.set(`${id}.md`, page)

          if (dryRun) {
            console.log('create %o %O\n%s\n', url.toString(), data, content)
          } else {
            await writePage(page)
          }
        },
        update: async (page) => {
          // Update the page
          page.content += '\n\n' + content
          page.data.refs.mastodon_status.push(status.id)

          if (dryRun) {
            console.log(
              'update %o %O\n%s\n',
              page.url.toString(),
              data,
              content,
            )
          } else {
            await writePage(page)
          }
        },
      })
    }
  }

  console.log('skipped statuses', skipped)
}

function prettyYaml(data) {
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

// The page needs to be re-written each time because the frontmatter + content change
async function writePage(page) {
  await fs.writeFile(
    page.url,
    ['---', prettyYaml(page.data), '---', '', page.content].join('\n') + '\n',
    'utf8',
  )
}

async function processMedia(allMedia, dryRun) {
  console.log('fetching media')

  for (const [id, media] of Object.entries(allMedia)) {
    console.log(' - ' + id)

    const url = new URL(`${id}.md`, getDirectoryUrl('content/media'))

    if (dryRun) {
      console.log('create %o', url.toString(), media)
    } else {
      // Put "original" media into S3
      const extension = path.extname(media.data.original)
      await emplaceS3Object(
        `mastodon/original/${id}${extension}`,
        media.data.original,
      )

      // Rewrite media's "original" URL before writing to file
      media.data.original = new URL(
        `./mastodon/original/${id}${extension}`,
        S3_CDN_URL,
      ).toString()

      if (media.data.preview) {
        const extension = path.extname(media.data.preview)

        // Put "preview" media into S3
        await emplaceS3Object(
          `mastodon/preview/${id}${extension}`,
          media.data.preview,
        )

        // Rewrite media's "preview" URL before writing to file
        media.data.preview = new URL(
          `./mastodon/preview/${id}${extension}`,
          S3_CDN_URL,
        ).toString()
      }

      // Write the page to disk
      await writePage({ url, data: media.data, content: media.content })
    }
  }
}

async function processLabels() {
  // ... ???
}

async function main() {
  const user = await lookupUser(mastodon.url, mastodon.username)

  const fromCache = process.argv.includes('--cached')
  const dryRun = process.argv.includes('--dry-run')

  for (const template of Object.keys(mastodon.types)) {
    const tpl = templates[template]
    if (!tpl) throw new Error(`Missing template '${template}'`)
  }

  const cache = fromCache
    ? JSON.parse(await fs.readFile(cacheURL, 'utf8'))
    : await fetchCache(user.id)

  await processMedia(cache.media, dryRun)

  await processThreads(cache.threads, dryRun)

  // TODO: process labels
}

//
// === MASTODON UTILS ===
//

/** 
  @param {string} tag
  */
async function* iterateUserHashtag(userId, tag) {
  // Construct a URL to fetch a user's status with that hashtag
  const endpoint = new URL(`./api/v1/accounts/${userId}/statuses`, mastodon.url)
  endpoint.searchParams.set('tagged', tag)

  // Remember which ids have been processed to not duplicate
  const visit = statusVisitor(userId)

  // Iterate through all the statuses
  for await (const status of iterateEndpoint(endpoint)) {
    yield* visit(status)

    const { ancestors = [], descendants = [] } = await getContext(
      mastodon.url,
      status.id,
    )
    yield* visit(...ancestors, ...descendants)
  }
}

//
// === OLD STUFF ===
//

async function downloadImage(media) {
  console.log('Download image', media.id)
  const res = await fetch(media.url)

  if (!res || !res.body) {
    console.error('Failed to download %o', media.url)
    return
  }

  const stream = createWriteStream(
    new URL('../' + getImagePath(media), import.meta.url),
  )
  res.body.pipeTo(Writable.toWeb(stream))
}

main().catch((error) => console.error('Mastodon failed', error))

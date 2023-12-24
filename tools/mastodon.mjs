#!/usr/bin/env node

import 'dotenv/config'

import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { Writable } from 'node:stream'
import parseLinkHeader from 'parse-link-header'
import Yaml from 'yaml'
import * as cheerio from 'cheerio'

import config from '../content/_data/mastodon.json' assert { type: 'json' }

const hashtags = new Set(['photos', 'review', 'notes', 'nowplaying'])

const headers = new Headers()
if (process.env.MASTODON_TOKEN) {
  headers.set('Authorization', `bearer ${process.env.MASTODON_TOKEN}`)
}

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

async function getImageNames() {
  const files = await fs.readdir(new URL('../images', import.meta.url))
  return files.map((n) => path.parse(n).name)
}

async function main() {
  const user = await lookupUser(config.url, config.username)

  await fs.mkdir(new URL('../content/mastodon', import.meta.url), {
    recursive: true,
  })

  // const visited = new Set()

  // TODO: read in file first
  // TODO: fetch metadata myself, its not always there in mastodon
  // TODO: it is getting non-me toots too
  // async function visit(status, extraTags) {
  //   if (visited.has(status.id)) return
  //   await createPage(status, extraTags)
  //   visited.add(status.id)
  // }

  const allMedia = new Map()
  const cache = { statuses: {}, media: {} }

  for (const tag of hashtags) {
    console.debug('Searching #%s', tag)

    for await (const status of iterateUserHashtag(user.id, tag)) {
      cache.statuses[status.id] = status
      console.debug(' - ', status.id)

      for (const media of status.media_attachments) {
        allMedia.set(media.id, media)
      }

      // TODO: upsert note/photos/films/trips...
    }
  }

  for (const media of allMedia.values()) {
    cache.media[media.id] = media

    // TODO: move media to S3 if not exists
  }

  cache.threads = Object.fromEntries(rethread(cache.statuses))

  await fs.mkdir(new URL('../.cache', import.meta.url), {
    recursive: true,
  })
  await fs.writeFile(
    new URL('../.cache/mastodon.json', import.meta.url),
    JSON.stringify(cache, null, 2),
  )
}

/** 
  @param {string} tag
  */
async function* iterateUserHashtag(userId, tag) {
  const endpoint = new URL(`./api/v1/accounts/${userId}/statuses`, config.url)
  endpoint.searchParams.set('tagged', tag)

  const visited = new Set()

  for await (const status of iterateEndpoint(endpoint)) {
    if (!visited.has(status.id)) {
      visited.add(status.id)
      yield status
    }

    const { ancestors = [], descendants = [] } = await getContext(
      config.url,
      status.id,
    )
    for (const status of [...ancestors, ...descendants]) {
      if (!visited.has(status.id)) {
        visited.add(status.id)
        yield status
      }
    }
  }
}

function rethread(statuses) {
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
function getOrigin(status, statuses) {
  let current = status
  while (current?.in_reply_to_id !== null) {
    current = statuses[current.in_reply_to_id]
  }
  return current
}

function emplace(map, key, operation = {}) {
  map.set(
    key,
    map.get(key) !== undefined
      ? operation.update?.(map.get(key), key, map)
      : operation.insert?.(key, map),
  )
}

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

async function fetchOpengraph(url) {
  const res = await fetch(url)
  if (!res.ok) return null

  const $ = cheerio.load(await res.text())

  return {
    type: $('meta[property="og:type"]')?.attr('content'),
    title:
      $('meta[name="twitter:title"]')?.attr('content') ??
      $('meta[property="og:title"]')?.attr('content') ??
      $('head > title')?.text(),
    description:
      $('meta[name="twitter:description"]')?.attr('content') ??
      $('meta[property="og:description"]')?.attr('content') ??
      $('meta[name="description"]')?.attr('content'),
    image: $('meta[property="og:image"]')?.attr('content'),
    url: $('meta[property="og:url"]')?.attr('content') ?? url,
  }
}

async function createPage(status, extraTags = []) {
  const tags = new Set([
    ...extraTags,
    ...status.tags.map((t) => `mastodon-${t.name}`),
    `mastodon-${status.id}`,
  ])

  const file = [
    '---',
    Yaml.stringify({
      id: status.id,
      createdAt: status.created_at,
      inReplyTo: status.in_reply_to_id,
      images: status.media_attachments
        .filter((m) => m.type === 'image')
        .map((m) => ({
          url: m.url,
          description: m.description,
          blurhash: m.blurhash,
          width: m.meta.original.width,
          height: m.meta.original.height,
        })),
      mentions: status.mentions,
      card: status.card && {
        url: status.card.url,
        title: status.card.title,
        description: status.card.description,
        image: status.card.image,
        blurhash: status.card.blurhash,
        width: status.card.width,
        height: status.card.height,
      },
      tags: Array.from(tags),
      permalink: false,
    }),
    '---',
    '',
    status.content,
  ]

  await fs.writeFile(
    new URL(`../content/mastodon/${status.id}.md`, import.meta.url),
    file.join('\n'),
  )
}

function getImagePath(media) {
  const ext = path.extname(media.url)
  return `images/mastodon/${media.id}${ext}`
}

main().catch((error) => console.error('Mastodon failed', error))

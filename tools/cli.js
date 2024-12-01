#!/usr/bin/env node

import 'dotenv/config'

import process from 'node:process'
import * as rl from 'node:readline/promises'

import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import sharp from 'sharp'

import {
  parseOpengraph,
  loadCollection,
  loadMedia,
  nextPage,
  writePage,
  resolveMedia,
} from '../utils.js'

import { scrapeMastodon } from './mastodon.js'

const dirs = {
  films: new URL('../content/films/', import.meta.url),
  media: new URL('../content/media/', import.meta.url),
}

function exit(message) {
  console.error(message)
  process.exit(1)
}

async function fetchOpenGraph(url) {
  console.log('Fetching metadata', url)
  const res = await fetch(url)
  if (!res.ok) exit('Failed to fetch metadata: ' + res.statusText)

  return parseOpengraph(url, await res.text())
}

async function createFilm(args = {}) {
  const prompt = rl.createInterface(process.stdin, process.stdout)

  const url = await prompt.question('TMDB URL: ')
  if (!url) exit('URL is required')

  const opengraph = await fetchOpenGraph(url)

  const collection = await loadCollection(dirs.films)
  const allMedia = await loadMedia(dirs.media)

  let media = null
  if (opengraph.image) {
    media = await fetchMedia({
      id: nextPage(allMedia.keys()),
      url: opengraph.image,
      title: opengraph.title,
    })
  }

  const id = nextPage(collection.keys())

  const date = new Date()
  date.setHours(0, 0, 0, 0)

  const film = {
    content: '',
    data: {
      date: date,
      media: media ? [`${media.id}`] : [],
      url: url,
      title: opengraph.title,
      blurb: opengraph.description,
    },
  }

  const pageUrl = new URL(`${id}.md`, dirs.films)
  const mediaUrl = media ? new URL(`${media.id}.md`, dirs.media) : null

  if (args.dryRun) {
    console.log('Create %s', pageUrl, film)

    if (media) {
      console.log('Create %s', mediaUrl, media)
    }
  } else {
    await writePage({ url: pageUrl, ...film })
    console.log('created content/films/%s.md', id)

    if (media) {
      await resolveMedia(media)
      await writePage({ url: mediaUrl, ...media })
      console.log('created content/media/%s.md', media.id)
    }
  }

  prompt.close()
}

async function fetchMedia({ url, title, id }) {
  console.log('Fetching image', url)
  const res = await fetch(url)
  if (!res.ok) exit('Failed to fetch media')

  const image = await sharp(await res.arrayBuffer()).metadata()

  return {
    id,
    content: title,
    data: {
      type: 'image',
      original: url,
      width: image.width,
      height: image.height,
    },
  }
}

async function createMedia(args = {}) {
  const prompt = rl.createInterface(process.stdin, process.stdout)

  const allMedia = await loadMedia(dirs.media)

  const title = await prompt.question('Enter caption: ')
  if (!title) exit('URL is required')

  const url = await prompt.question('Enter file URL: ')
  if (!url) exit('URL is required')

  const id = nextPage(allMedia.keys())

  const media = await fetchMedia({ id, url, title })
  const mediaUrl = new URL(`${media.id}.md`, dirs.media)

  if (args.dryRun) {
    console.log('Create %s', mediaUrl, media)
  } else {
    await resolveMedia(media)
    await writePage({ url: mediaUrl, ...media })
    console.log('created content/media/%s.id', media.id)
  }

  prompt.close()
}

const cli = yargs(hideBin(process.argv))
  .help()
  .alias('h', 'help')
  .demandCommand(1, 'command is required')
  .recommendCommands()
  .option('dry-run', { type: 'boolean' })

cli.command(
  'create <type>',
  'Create a piece of content',
  (yargs) =>
    yargs.positional('type', {
      choices: ['film', 'note', 'label', 'media'],
    }),
  (args) => {
    if (args.type === 'film') return createFilm(args)
    if (args.type === 'media') return createMedia(args)
    throw new Error('Not implemented')
  },
)

cli.command(
  'opengraph <url>',
  'Fetch opengraph metadata from a URL',
  (yargs) => yargs.positional('url', { type: 'string' }),
  async (args) => {
    console.log('Opengraph', await fetchOpenGraph(args.url))
  },
)

cli.command(
  'mastodon',
  'Run the Mastodon scraper',
  (yargs) =>
    yargs
      .option('dry-run', { type: 'boolean', default: false })
      .option('overwrite', { type: 'boolean', default: false })
      .option('from-cache', { type: 'boolean', default: false }),
  (args) => scrapeMastodon(args),
)

async function main() {
  try {
    await cli.parseAsync()
  } catch (error) {
    console.error('Fatal error:', e)
  }
}

main()

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

const dirs = {
  films: new URL('../content/films/', import.meta.url),
  media: new URL('../content/media/', import.meta.url),
}

function exit(message) {
  console.error(message)
  process.exit(1)
}

async function createFilm(args = {}) {
  const prompt = rl.createInterface(process.stdin, process.stdout)

  const url = await prompt.question('TMDB URL: ')
  if (!url) exit('URL is required')

  console.log('Fetching metadata', url)
  const res = await fetch(url)
  if (!res.ok) exit('Failed to fetch metadata: ' + res.statusText)

  const collection = await loadCollection(dirs.films)
  const allMedia = await loadMedia(dirs.media)

  const opengraph = parseOpengraph(url, await res.text())

  let media = null
  if (opengraph.image) {
    console.log('Fetching image', opengraph.image)
    const res = await fetch(opengraph.image)
    if (!res.ok) exit('Failed to fetch media')

    const image = await sharp(await res.arrayBuffer()).metadata()

    media = {
      id: nextPage(allMedia.keys()),
      content: opengraph.title,
      data: {
        type: 'image',
        original: opengraph.image,
        width: image.width,
        height: image.height,
      },
    }
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
    console.log('created content/films/%s.id', id)

    if (media) {
      await resolveMedia(media)
      await writePage({ url: mediaUrl, ...media })
      console.log('created content/media/%s.id', media.id)
    }
  }

  prompt.close()
}

const cli = yargs(hideBin(process.argv))
  .help()
  .alias('h', 'help')
  .demandCommand(1, 'command is required')
  .recommendCommands()

cli.command(
  'create <type>',
  'Create a piece of content',
  (yargs) =>
    yargs
      .positional('type', {
        choices: ['film', 'note', 'label'],
      })
      .option('dry-run', { type: 'boolean' }),
  (args) => {
    if (args.type === 'film') return createFilm(args)
    throw new Error('Not implemented')
  },
)

async function main() {
  try {
    await cli.parseAsync()
  } catch (error) {
    console.error('Fatal error:', e)
  }
}

main()

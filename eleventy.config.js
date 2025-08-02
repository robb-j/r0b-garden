import 'dotenv/config'

import { eleventyAlembic } from '@openlab/alembic/11ty.cjs'
import { feedPlugin } from '@11ty/eleventy-plugin-rss'
import markdown from 'markdown-it'
import markdownAnchor from 'markdown-it-anchor'
import syntaxHighlight from '@11ty/eleventy-plugin-syntaxhighlight'
import * as cheerio from 'cheerio'

import { emplace } from './utils.js'
import datesPlugin from './config/dates.js'

/** @param {Date} date */
function monthlyKey(date) {
  return `${date.getFullYear()}-${(date.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-01`
}

const shortDate = new Intl.DateTimeFormat('en-GB', {
  timeStyle: undefined,
  dateStyle: 'medium',
})

const filters = {
  findBySlug(collection, slug) {
    return collection.find((item) => item.page.fileSlug === slug)
  },
  groupByMonth(collection) {
    const buckets = new Map()
    for (const item of collection) {
      emplace(buckets, monthlyKey(item.page.date), {
        insert: () => [item],
        update: (arr) => arr.concat([item]),
      })
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, collection]) => ({
        date: new Date(month),
        collection: collection.reverse(),
      }))
      .reverse()
  },
  mastodonStatusLink(refs) {
    return refs?.mastodon_status?.[0] ?? null
  },
  isActiveLabel(label, tags) {
    return tags.some((t) => t === `label:${label.fileSlug}`)
  },
  tagsToLabels(labels, tags) {
    return tags
      .map((tag) => labels.find((l) => tag === `label:${l.fileSlug}`))
      .filter((v) => v)
  },
  pickTitle(item) {
    return item.data.title ?? shortDate.format(item.page.date)
  },
  htmlText(inputText) {
    return cheerio.load(inputText).text()
  },
  sortByTitle(collection) {
    return Array.from(collection).sort((a, b) =>
      a.data.title.localeCompare(b.data.title),
    )
  },
}

const videoTypes = new Set(['gifv', 'video'])
const imageTypes = new Set(['image'])

function renderMedia(media, width = media?.data?.width) {
  if (!media) {
    console.error('Media not found %s', id)
    return ''
  }

  const autoHeight = width * (media.data.height / media.data.width)

  if (videoTypes.has(media.data?.type)) {
    return [
      `<video controls width="${width}" height="${autoHeight}">`,
      `<source src="${media.data.original}" />`,
      `</video>`,
    ].join('')
  }

  if (imageTypes.has(media.data?.type)) {
    return `<img src="${media.data.original}" width="${width}" height="${autoHeight}" alt="${media.data.alt ?? ''}">`
  }

  console.log('unknown media', media?.data?.type)

  return ''
}

function lookup(collection, id) {
  return collection?.find((item) => item.page.fileSlug === `${id}`)
}

const shortcodes = {
  related(kind, id) {
    const item = lookup(this.ctx.collections[kind], id)

    if (!item) {
      console.error('related not found %s %s', kind, id)
      return ''
    }

    const { title = `${kind}/${id}` } = item?.data ?? {}
    return `<a class="related" href="${item.url}">related: ${title}</a>`
  },
  external(url, text = url) {
    return [
      '<div class="pulled">',
      `<a href="${url}">${text}</a>`,
      '</div>',
    ].join('')
  },
  async media(media, width) {
    if (typeof media === 'string' || typeof media === 'number') {
      media = lookup(this.ctx.collections.media, media)
    }

    // NOTE: this is an undocumented API
    const { content } = await media.template.read()

    return [
      `<figure>`,
      renderMedia(media, width),
      `<figcaption>${content}</figcaption>`,
      `</figure>`,
    ].join('')
  },
  media_element(media, width = media?.data?.width) {
    if (typeof media === 'string' || typeof media === 'number') {
      media = this.ctx.collections.media.find(
        (item) => item.page.fileSlug === `${media}`,
      )
    }
    return renderMedia(media, width)
  },
  media_image_preview(media, width = media.data.width) {
    if (
      imageTypes.has(media?.data?.type) ||
      videoTypes.has(media?.data?.type)
    ) {
      const height = width * (media.data.height / media.data.width)
      const src = media.data.preview ?? media.data.original
      return [
        `<picture>`,
        `<source srcset="${media.data.original}" media="(max-width: ${width}px)" />`,
        `<img src="${src}" width="${width}" height="${height}" loading="lazy" autoplay controls poster=${media.data.preview}>`,
        `</picture>`,
      ].join('\n')
    }
    return ''
  },
}

// const feeds = [
//   {
//     type: 'json',
//     outputPath: '/films.json',
//     collection: { name: 'film', limit: 0 },
//     metadata: {
//       language: 'en',
//       title: "Rob's Films",
//       subtitle: "The films I've watched recently",
//       base: 'https://garden.r0b.io/',
//       author: { name: 'Rob Anderson' },
//     },
//   },
//   {
//     type: 'json',
//     outputPath: '/photos.json',
//     collection: { name: 'photo', limit: 0 },
//     metadata: {
//       language: 'en',
//       title: "Rob's Pics",
//       subtitle: "Nice pictures I've taken for you",
//       base: 'https://garden.r0b.io/',
//       author: { name: 'Rob Anderson' },
//     },
//   },
//   {
//     type: 'json',
//     outputPath: '/notes.json',
//     collection: { name: 'note', limit: 0 },
//     metadata: {
//       language: 'en',
//       title: "Rob's Notes",
//       subtitle: "Thoughts I've had that might be interesting",
//       base: 'https://garden.r0b.io/',
//       author: { name: 'Rob Anderson' },
//     },
//   },
// ]

const feedOptions = {
  type: 'json',
  outputPath: '/feed.json',
  collection: {
    name: 'all',
    limit: 500,
  },
  metadata: {
    language: 'en',
    title: "Rob's garden feed",
    subtitle: "All the stuff I've put in my CanvasGradient, right in your feed",
    base: 'https://garden.r0b.io/',
    author: { name: 'Rob Anderson' },
  },
}

/** @param {import("@11ty/eleventy/src/UserConfig.js").default} eleventyConfig */
export default function (eleventyConfig) {
  eleventyConfig.addPlugin(syntaxHighlight)
  eleventyConfig.addPlugin(eleventyAlembic, { useLabcoat: true })
  eleventyConfig.addPlugin(datesPlugin)
  eleventyConfig.addPlugin(syntaxHighlight)
  // eleventyConfig.addPlugin(feedPlugin, feedOptions)

  const md = markdown({ linkify: true, html: true })
  md.use(markdownAnchor)
  eleventyConfig.setLibrary('md', md)

  for (const [name, fn] of Object.entries(filters)) {
    eleventyConfig.addFilter(name, fn)
  }
  for (const [name, fn] of Object.entries(shortcodes)) {
    eleventyConfig.addShortcode(name, fn)
  }

  eleventyConfig.addPassthroughCopy('assets')

  eleventyConfig.setServerOptions({ domDiff: false })

  eleventyConfig.setQuietMode(true)

  return {
    dir: {
      input: 'content',
      layouts: '_layouts',
    },
    htmlTemplateEngine: 'njk',
    markdownTemplateEngine: 'njk',
  }
}

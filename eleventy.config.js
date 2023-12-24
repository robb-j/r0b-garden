import 'dotenv/config'

import { eleventyAlembic } from '@openlab/alembic/11ty.cjs'
import markdown from 'markdown-it'
import markdownAnchor from 'markdown-it-anchor'
import syntaxHighlight from '@11ty/eleventy-plugin-syntaxhighlight'

import { emplace } from './utils.js'
import datesPlugin from './config/dates.js'

/** @param {Date} date */
function monthlyKey(date) {
  return `${date.getFullYear()}-${(date.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-01`
}

const filters = {
  findBySlug(collection, slug) {
    return collection.find((item) => item.page.fileSlug === slug)
  },
  log(...args) {
    console.log(...args)
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
      .map(([month, collection]) => ({ date: new Date(month), collection }))
  },
  mastodonStatusLink(id) {
    // TODO: this should be from data
    return `https://hyem.tech/@rob/${id}`
  },
}

const shortcodes = {
  media_image(media, width = media.data.width) {
    const height = width * (media.data.height / media.data.width)
    return `<img src="${media.data.original}" width="${width}" height="${height}">`
  },
}

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(syntaxHighlight)
  eleventyConfig.addPlugin(eleventyAlembic, { useLabcoat: true })
  eleventyConfig.addPlugin(datesPlugin)

  const md = markdown({ html: true })
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

  return {
    dir: {
      input: 'content',
      layouts: '_layouts',
    },
    htmlTemplateEngine: 'njk',
    markdownTemplateEngine: 'njk',
  }
}

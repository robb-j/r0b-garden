import 'dotenv/config'

import { eleventyAlembic } from '@openlab/alembic/11ty'
import markdown from 'markdown-it'
import markdownAnchor from 'markdown-it-anchor'
import syntaxHighlight from '@11ty/eleventy-plugin-syntaxhighlight'

/** @param {import('@11ty/eleventy/src/UserConfig')} eleventyConfig */
export default function (eleventyConfig) {
  const md = markdown({ html: true })
  md.use(markdownAnchor)
  eleventyConfig.setLibrary('md', md)

  const shortDate = new Intl.DateTimeFormat('en-GB', {
    timeStyle: 'short',
    dateStyle: 'short',
    hour12: false,
  })
  eleventyConfig.addFilter('shortDate', (v) => {
    return shortDate.format(new Date(v))
  })

  eleventyConfig.addPlugin(syntaxHighlight)
  eleventyConfig.addPlugin(eleventyAlembic, {
    useLabcoat: true,
  })

  return {
    dir: {
      input: 'content',
      includes: '_includes',
      layouts: '_layouts',
    },
    templateFormats: ['11ty.js', 'njk', 'md'],
    htmlTemplateEngine: 'njk',
    markdownTemplateEngine: 'njk',
  }
}

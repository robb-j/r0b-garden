import fs from 'node:fs'
import matter from 'gray-matter'

import { writePage } from '../utils.js'

//
// A little script to replace the old id-based ref format with full URLs
// ~ after moving my mastodon server from hyem.tech
//

const prefix = 'https://hyem.tech/@rob/'

for (const name of fs.globSync('content/**/*.md')) {
  const { content = '', data = {} } = matter(fs.readFileSync(name, 'utf8'))

  if (!data.refs?.mastodon_status) continue

  for (let i = 0; i < data.refs.mastodon_status.length; i++) {
    if (data.refs.mastodon_status[i].startsWith('https://')) continue
    data.refs.mastodon_status[i] = new URL(
      data.refs.mastodon_status[i],
      prefix,
    ).toString()
  }
  await writePage({ url: name, data, content: content.trim() })
}

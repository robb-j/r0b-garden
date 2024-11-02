import fs from 'node:fs'
import matter from 'gray-matter'

import { writePage } from '../utils.js'

//
// A little script to replace the old id-based ref format with full URLs
// ~ after moving my mastodon server from hyem.tech
//

const prefix = 'https://hyem.tech/@rob/'
const toReplace = ['mastodon_status', 'mastodon_card']

for (const name of fs.globSync('content/**/*.md')) {
  const { content = '', data = {} } = matter(fs.readFileSync(name, 'utf8'))
  let changed = false

  for (const key of toReplace) {
    if (!data.refs?.[key]) continue

    for (let i = 0; i < data.refs[key].length; i++) {
      if (data.refs[key][i].startsWith('https://')) continue
      data.refs[key][i] = new URL(data.refs[key][i], prefix)
      changed = true
    }
  }
  if (changed) {
    await writePage({ url: name, data, content: content.trim() })
  }
}

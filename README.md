# r0b-garden

...

## notes

**docs**

- [Minio](https://min.io/docs/minio/linux/developers/javascript/API.html)
- [Nunjucks](https://mozilla.github.io/nunjucks/templating.html)
- [Cheerio](https://cheerio.js.org/docs/api)
- [Yaml](https://eemeli.org/yaml/#yaml)
- [Sharp](https://sharp.pixelplumbing.com/)

**thoughts**

- What happens to markdown code blocks in toots?
- What can I use the blur hash for?

**goals**

- keep large media out of the repo
- pull content from everywhere
- facilitate curation of content by editing, linking and tagging
- static please

**todos**

- maybe try WebC
- get `tools/mastodon.js` to produce content in the desired format
- notes should show the `card.url`
- rss feeds
- film date changes aren't working
- organise utils into a `lib/` folder of multiple files
- media overwrite?
- generate labels
- what to do with #HashTags (convert to links from HTML or processes in-markdown?)
- need to merge labels into pages in `statusFrontmatter` + `updatePage`
  - and media too
  - any other fields?

---

# Landa

> Named for Hans (Inglorious Bastards)

Landa is a JavaScript library to help you curate markdown files based on external sources.
Maybe you have statuses on Mastodon or posts on Strava and you want to pull them into you website in a meaningful way.
Landa creates markdown files from the external sources you hook up.
Then it relies on the front-matter in your markdown files to reference external sources so you know which files belong to which external entities.

```md
---
refs:
  mastodon_status: [123456789]
---

Hello, World!
```

When you first run your fetch, it'll generate this markdown file for you based on your Landa configuration.
When you run the fetch again, Landa will know that the status has already been processed and not to process it again.
If you fetch the thread and there is a new status, Landa now knows to append onto this file rather than create a new one.

For example:

```md
---
refs:
  mastodon_status: [123456789, 987654321]
---

Hello, World!

And another thing
```

Landa is a lower-level library to facilitate this sort of interaction.
That is, having markdown files based on external sources that might change in the future.

> Landa doesn't currently support updates to existing fetch data.
> This is by design, to not over-complicate the format of the markdown file for the majority of use-cases.

## Foreword

Landa doesn't currently exist (as of writing this documentation).
This documentation is written as [documentation-driven-design](https://blog.r0b.io/post/isomorphic-javascript-web-standards-and-documentation-driven-design/).
The idea is to write free-from implementation details to design better APIs.

## Background

Landa was created as an off-shoot of my digital garden, [garden.r0b.io](https://garden.r0b.io),
where I designed and developed these techniques to pull in content to my garden.

The garden it self is my interpretation of digital gardens, where content is continually pulled in from external sources.
Then I go through the garden to curate and tidy up the overgrowing content.

## Usage

Landa starts with a configuration file.
This defines the types of content you want to pull in and how to do that.

**config.js**

```js
import { getStatusMarkdown, getStatusFrontMatter } from 'landa/mastodon.js'

const film = {
  hashtags: ['review'],
  directory: 'content/films',
  template: (status) => ({
    data: {
      ...getStatusFrontMatter(status),
      url: status.card?.url,
      title: status.card?.title,
      blurb: status.card?.description,
    },
    content: getStatusMarkdown(status, {
      stripUrls: [status.card?.url],
    }),
  }),
}

export const config = {
  mastodon: {
    url: 'https://example.com',
    username: 'rob',
    types: { film },
  },
}
```

With that config, you can write a script to fetch that content.
You can run that script yourself during development or in a cronjob for production.

**tools/mastodon.js**

```js
import 'dotenv/config.js'
import process from 'node:process'

import { Landa, S3Media } from 'landa'
import { LandaMastodon } from 'landa/mastodon.js'

import { config } from './config.js'

const args = {
  fromCache: process.argv.includes('--cached'),
  dryRun: process.argv.includes('--dry-run'),
  overwrite: process.argv.includes('--overwrite'),
}

const media = new S3Media({
  prefix: '/',
  accessKey: process.env.S3_ACCESS_KEY,
  secretKey: process.env.S3_SECRET_KEY,
  endPoint: process.env.S3_ENDPOINT,
})
const landa = new Landa({
  baseUrl: import.meta.url,
  cacheFile: '.cache/mastodon.json',
  args,
  media,
})
const mastodon = new LandaMastodon({
  url: config.mastodon.url,
  token: process.env.MASTODON_TOKEN,
})

const user = await mastodon.lookupUser(config.mastodon.username)

const oldMedia = await landa.loadMedia('content/media')

const { statuses, allMedia } = await mastodon.fetch()
const newMedia = landa.mapDiff(oldMedia, allMedia)

for (const media of newMedia) {
  const url = landa.nextPageUrl(media.id, 'content/media')

  if (args.dryRun) {
    console.log('create media', url.toString(), media)
  } else {
    await landa.resolveMedia(media)
    await landa.createPage(media)
  }
}

const threads = mastodon.threadStatuses(statuses)
const collections = mastodon.loadCollections(landa)

for (const thread of threads) {
  for (const status of thread) {
    const type = mastodon.getStatusType(status)
    // const type = config.mastodon.types[status.meta.type]

    // can this have meta info on it too
    // e.g { items: Map<string, T>, directory: URL, extension: '.md' }
    const collection = collections[status.meta.type]

    const { content, data } = type.template(status)
    landa.addRef(data, 'mastodon_status', status.id)

    const page = landa.findByRef(collection, 'mastodon_status', status.id)

    // TODO: is this simpler?
    // await landa.processPage({
    //   page,
    //   collection,
    //   data,
    //   content
    // })

    // Sketching out the internal API too
    if (page) {
      if (args.overwrite) {
        await landa.overwritePage(page, collection, data, content)
      } else if (args.dryRun) {
        console.log('update', status.id)
      } else {
        await landa.updatePage(page, collection, data, content)
      }
    } else {
      await landa.createPage()
    }
  }
}

// overwritePage(page, collection, data, content)
// - either writes the page or re-appends to it
// - based on if the new data is the first reference
// - resets refs (if first) so other overwrites update properly
//
// updatePage(page, collection, data, content)
// - concats the content on the end
// - merges refs together
// - merges media together
// - anything mastodon-specific needed here?
// - dry run if arg is set
// - write to fs
// - update in-memory version
//
// createPage(collection, data, content)
// - work out the next id of the collection
// - insert the page
// - write to fs
// - add to collection

const labels = await landa.loadCollection('content/labels')

for (const tag of mastodon.findLabelHashtags(statuses)) {
  const url = new URL(tag.name + labels.extension, labels.directory)
  const data = { title: tag.name }
  landa.addRef(data, 'mastodon_hashtag', tag.name)

  await landa.processPage({
    // TODO: is this needed? (can it find the page from the refs on "data"?)
    // landa.findByRef(labels, 'mastodon_hashtag', tag.name),
    collection,
    data,
    content: '',
    url, // Take an optional URL?
  })
}
```

Now we can run our script with Node, with any combination of parameters:

```
node tools/mastodon.js [--dry-run] [--cached] [--overwrite]
```

---

## rob's Landa notes

- system for detecting stale entries, i.e. a deleted mastodon post

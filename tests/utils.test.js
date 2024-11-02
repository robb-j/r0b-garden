import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import dedent from 'dedent'
import * as cheerio from 'cheerio'

import {
  emplace,
  statusVisitor,
  rethread,
  getOrigin,
  loadCollection,
  nextPage,
  isRef,
  emplaceStatus,
  statusText,
  statusFrontmatter,
  statusUrls,
  getAttachmentMedia,
  getCardMedia,
  parseOpengraph,
  isJustTags,
} from '../utils.js'

describe('emplace', () => {
  it('inserts values', () => {
    const map = new Map()
    emplace(map, 'a', {
      insert: () => 'value',
    })
    assert.equal(map.get('a'), 'value', 'should put the value into the map')
  })
  it('updates values', () => {
    const map = new Map()
    map.set('a', ['first'])
    emplace(map, 'a', {
      update: (value) => value.concat(['second']),
    })
    assert.deepEqual(
      map.get('a'),
      ['first', 'second'],
      'should update the existing value',
    )
  })
})

describe('statusVisitor', () => {
  it('yields statuses from the user', () => {
    const visit = statusVisitor(9)
    const account = { id: 9 }
    const result = Array.from(
      visit({ id: 1, account }, { id: 2, account }, { id: 3, account }),
    )
    assert.deepEqual(
      result,
      [
        { id: 1, account },
        { id: 2, account },
        { id: 3, account },
      ],
      'should yield each of the statuses',
    )
  })
  it('de-duplicates statuses', () => {
    const visit = statusVisitor(9)
    const account = { id: 9 }
    const result = Array.from(visit({ id: 1, account }, { id: 1, account }))
    assert.deepEqual(
      result,
      [{ id: 1, account }],
      'should only yields a status once',
    )
  })
  it('ignores non-author statuses', () => {
    const visit = statusVisitor(9)

    assert.deepEqual(
      Array.from(visit({ id: 1, account: { id: 7 } })),
      [],
      'should only yield status from the set user',
    )
  })
  it('ignores author replies to non-author', () => {
    const visit = statusVisitor(9)
    assert.deepEqual(
      Array.from(
        visit({ id: 1, account: { id: 9 }, in_reply_to_account_id: 7 }),
      ),
      [],
      'should only yield replies to the author themselves',
    )
  })
})

describe('getOrigin', () => {
  it('looks up the parent', () => {
    const statuses = {
      1: { in_reply_to_id: null },
      2: { in_reply_to_id: 1 },
    }
    assert.deepEqual(
      getOrigin(statuses[2], statuses),
      statuses[1],
      'should look up the parent based on in_reply_to_id',
    )
  })
  it('looks up multiple parents', () => {
    const statuses = {
      1: { in_reply_to_id: null },
      2: { in_reply_to_id: 1 },
      3: { in_reply_to_id: 2 },
      4: { in_reply_to_id: 3 },
    }
    assert.deepEqual(
      getOrigin(statuses[4], statuses),
      statuses[1],
      'should look through multiple parents using in_reply_to_id',
    )
  })
  it('stops for unknown parents', () => {
    const statuses = {
      1: { in_reply_to_id: null },
    }
    assert.deepEqual(
      getOrigin(statuses[1], statuses),
      statuses[1],
      'should return the status if it has no parent',
    )
  })
})

describe('rethread', () => {
  it('groups into threads', () => {
    const statuses = {
      1: { id: 1, in_reply_to_id: null, created_at: '2024-01-01 09:00:00' },
      2: { id: 2, in_reply_to_id: 1, created_at: '2024-01-01 10:00:00' },
      3: { id: 3, in_reply_to_id: 2, created_at: '2024-01-01 11:00:00' },
      4: { id: 4, in_reply_to_id: 3, created_at: '2024-01-01 12:00:00' },
    }
    assert.deepEqual(
      rethread(statuses).get(1),
      [statuses[1], statuses[2], statuses[3], statuses[4]],
      'should group the statuses based on their origin status',
    )
  })
  it('sorts by created date', () => {
    const statuses = {
      1: { id: 1, in_reply_to_id: null, created_at: '2024-01-01 09:00:00' },
      2: { id: 2, in_reply_to_id: 1, created_at: '2024-01-01 11:00:00' },
      3: { id: 3, in_reply_to_id: 2, created_at: '2024-01-01 12:00:00' },
      4: { id: 4, in_reply_to_id: 3, created_at: '2024-01-01 10:00:00' },
    }
    assert.deepEqual(
      rethread(statuses).get(1),
      [statuses[1], statuses[4], statuses[2], statuses[3]],
      'should sort threads based on created_at as a string',
    )
  })
})

describe('loadCollection', () => {
  it('loads pages', async () => {
    const result = await loadCollection(
      new URL('./fixtures/pages/', import.meta.url),
    )
    assert.equal(
      result.get('1.md').content.trim(),
      'First page',
      'should parse markdown content',
    )
    assert.deepEqual(
      result.get('1.md').data,
      {
        date: new Date('2024-01-01T09:00:00.000Z'),
        refs: {
          mastodon_status: ['https://example.com/statuses/1'],
        },
      },
      'should parse YAML frontmatter',
    )
  })
})

describe('nextPage', () => {
  it('returns the id', () => {
    assert.equal(
      nextPage(['1.md', '2.html', '3']),
      4,
      'should find next numeric filename',
    )
  })
  it('returns 1 by default', () => {
    assert.equal(
      nextPage(['some.json', 'another.yml']),
      1,
      'should find next numeric filename',
    )
  })
})

describe('isRef', () => {
  it('checks if reference', () => {
    assert(
      isRef(
        { data: { refs: { toot: ['https://example.com/1'] } } },
        'toot',
        'https://example.com/1',
      ),
      'should be a reference if it is in data.refs[kind]',
    )
  })
})

describe('emplaceStatus', () => {
  it('inserts missing statuses', ({ mock }) => {
    const insert = mock.fn()
    const pages = new Map()
    const statuses = {}
    emplaceStatus({ url: 'https://example.com/1' }, pages, statuses, { insert })
    assert(
      insert.mock.callCount(),
      'should insert a page if there is no matching one',
    )
  })
  it('ignores present statuses', ({ mock }) => {
    const skip = mock.fn()
    const pages = new Map()
    const statuses = {}
    pages.set('1.md', {
      data: { refs: { mastodon_status: ['https://example.com/1'] } },
    })
    emplaceStatus({ url: 'https://example.com/1' }, pages, statuses, { skip })
    assert(
      skip.mock.callCount(),
      'should do nothing if their is already a page referencing the status',
    )
  })
  it('updates missing statuses', ({ mock }) => {
    const update = mock.fn()
    const pages = new Map()
    const statuses = {
      1: { url: 'https://example.com/1' },
    }
    pages.set('1.md', {
      data: { refs: { mastodon_status: ['https://example.com/1'] } },
    })
    emplaceStatus(
      { url: 'https://example.com/2', in_reply_to_id: 1 },
      pages,
      statuses,
      { update },
    )
    assert(
      update.mock.callCount(),
      'should update a page if the status is a reply to it',
    )
  })
  it('allows missing operations', () => {
    const pages = new Map()
    const statuses = {
      1: { url: 'https://example.com/1' },
      2: { url: 'https://example.com/2' },
    }
    emplaceStatus({ url: 'https://example.com/1' }, pages, statuses)

    pages.set('1.md', {
      data: { refs: { mastodon_status: ['https://example.com/1'] } },
    })
    emplaceStatus({ url: 'https://example.com/1' }, pages, statuses)

    pages.set('2.md', {
      data: { refs: { mastodon_status: ['https://example.com/2'] } },
    })
    emplaceStatus(
      { url: 'https://example.com/3', in_reply_to_id: 2 },
      pages,
      statuses,
    )

    // Non of the above should throw
  })
})

describe('statusText', () => {
  it('strips URLs', () => {
    assert.equal(
      statusText('<p>Hello <a href="https://example.com">#Something</a></p>', {
        stripUrls: ['https://example.com'],
      }),
      'Hello',
      'should remove the anchor and trim text',
    )
  })

  it('trims empty paragraphs', () => {
    assert.equal(
      statusText('<p><a href="https://example.com">Something</a></p>', {
        stripUrls: ['https://example.com'],
      }),
      '',
      // 'should remove paragraphs with only those anchors in',
    )
  })

  it('strips urls case-insensitively', () => {
    assert.equal(
      statusText(
        '<p>Hello <a href="https://example.com/Something">#Something</a></p>',
        {
          stripUrls: ['https://example.com/something'],
        },
      ),
      'Hello',
      // 'should remove paragraphs with only those anchors in',
    )
  })

  it('generates markdown #1', () => {
    const result = statusText(
      '<p>Added a JS Module loader to <a href="https://hyem.tech/tags/ProgrammableThings" class="mention hashtag" rel="tag">#<span>ProgrammableThings</span></a> so you can load other modules on your SD card and played around with the c++ -- JS API to set specific segments from JS <a href="https://hyem.tech/tags/Notes" class="mention hashtag" rel="tag">#<span>Notes</span></a></p>',
      {},
    )
    assert.equal(
      result,
      'Added a JS Module loader to #ProgrammableThings so you can load other modules on your SD card and played around with the c++ -- JS API to set specific segments from JS #Notes',
    )
  })
  it('generates markdown #2', () => {
    const result = statusText(
      dedent`
        <p>I was thinking about server app configuration today for <a href="https://hyem.tech/tags/Gruber" class="mention hashtag" rel="tag">#<span>Gruber</span></a>. I came up with a pretty clean API to load in variables from either configuration/environment variables/command line arguments or fallbacks. I updated my documentation-driven readme exploring it too. </p><p>Then I realised that same configuration can be used to document and provide usage examples which is kinda neat. </p>
        
        <p><a href="https://github.com/robb-j/gruber#configuration" target="_blank" rel="nofollow noopener noreferrer" translate="no"><span class="invisible">https://</span><span class="ellipsis">github.com/robb-j/gruber#confi</span><span class="invisible">guration</span></a></p>
        
        <p><a href="https://hyem.tech/tags/Notes" class="mention hashtag" rel="tag">#<span>Notes</span></a> <a href="https://hyem.tech/tags/JavaScript" class="mention hashtag" rel="tag">#<span>JavaScript</span></a> <a href="https://hyem.tech/tags/NodeJS" class="mention hashtag" rel="tag">#<span>NodeJS</span></a> <a href="https://hyem.tech/tags/Deno" class="mention hashtag" rel="tag">#<span>Deno</span></a></p>
      `,
      {
        stripUrls: ['https://github.com/robb-j/gruber#configuration'],
      },
    )
    assert.equal(
      result,
      dedent`
        I was thinking about server app configuration today for #Gruber. I came up with a pretty clean API to load in variables from either configuration/environment variables/command line arguments or fallbacks. I updated my documentation-driven readme exploring it too.
      
        Then I realised that same configuration can be used to document and provide usage examples which is kinda neat.
      `,
    )
  })
  it('generates markdown #3', () => {
    const result = statusText(
      dedent`
        <p><a href="https://hyem.tech/tags/TIL" class="mention hashtag" rel="tag">#<span>TIL</span></a> you can change the implementation of <a href="https://hyem.tech/tags/JavaScript" class="mention hashtag" rel="tag">#<span>JavaScript</span></a>&#39;s instanceof operator using Symbol.hasInstance</p>
        
        <p>\`\`\`js<br />export class TheAnswer {<br />  static [Symbol.hasInstance](value) {<br />    return value == 42;<br />  }<br />}<br />\`\`\`</p>
        
        <p>then</p>
        
        <p>\`\`\`<br />// true<br />42 instanceof TheAnswer<br />\`\`\`</p>
      `,
    )
    assert.equal(
      result,
      dedent`
        #TIL you can change the implementation of #JavaScript's instanceof operator using Symbol.hasInstance
        
        \`\`\`js
        export class TheAnswer {
          static [Symbol.hasInstance](value) {
            return value == 42;
          }
        }
        \`\`\`
      
        then
        
        \`\`\`
        // true
        42 instanceof TheAnswer
        \`\`\`
      `,
    )
  })
})

describe('isJustTags', () => {
  it('detects tag-only paragraphs', () => {
    const $ = cheerio.load(
      `<p> <a rel="tag">#Tag</a> <a rel="tag">#Tag</a> <a rel="tag">#Tag</a> </p>`,
    )
    for (const p of $('p')) {
      const result = isJustTags($(p))
      assert(result)
    }
  })
})

describe('statusFrontmatter', () => {
  it('generates frontmatter', () => {
    assert.deepEqual(
      statusFrontmatter({
        url: 'https://example/com/1',
        created_at: '2024-01-01 10:00:00',
        meta: {
          media: ['1.md', '2.md'],
        },
      }),
      {
        refs: {
          mastodon_status: ['https://example/com/1'],
        },
        date: new Date('2024-01-01 10:00:00'),
        media: ['1.md', '2.md'],
      },
      'should have the status reference and date in it',
    )
  })
})

describe('statusUrls', () => {
  it('contains the card url', () => {
    assert.deepEqual(
      statusUrls({
        card: { url: 'https://example.com/card' },
      }),
      ['https://example.com/card'],
      'should include the url from status.card.url',
    )
  })
})

describe('getAttachmentMedia', () => {
  it('converts to media', () => {
    assert.deepEqual(
      getAttachmentMedia({
        id: 1,
        type: 'image',
        url: 'https://example.com/original/abcdef.jpg',
        preview_url: 'https://example.com/preview/abcdef.jpg',
        meta: {
          original: {
            width: 400,
            height: 300,
          },
        },
        blurhash: 'plop',
        description: 'cool image',
      }),
      {
        data: {
          type: 'image',
          original: 'https://example.com/original/abcdef.jpg',
          preview: 'https://example.com/preview/abcdef.jpg',
          width: 400,
          height: 300,
          blurhash: 'plop',
          refs: {
            mastodon_media: [1],
          },
        },
        content: 'cool image',
      },
      'should convert to a media object',
    )
  })
})

describe('getCardMedia', () => {
  it('converts to media', () => {
    assert.deepEqual(
      getCardMedia({
        url: 'https://example.com/1',
        card: {
          image: 'https://example.com/original/abcdef.jpg',
          width: 400,
          height: 300,
          blurhash: 'plop',
          title: 'cool image',
        },
      }),
      {
        data: {
          type: 'image',
          original: 'https://example.com/original/abcdef.jpg',
          width: 400,
          height: 300,
          blurhash: 'plop',
          refs: {
            mastodon_card: ['https://example.com/1'],
          },
        },
        content: 'cool image',
      },
      'should convert to a media object',
    )
  })
})

describe('parseOpengraph', () => {
  it('parses html', () => {
    assert.deepEqual(
      parseOpengraph(
        'https://example.com',
        `
          <html>
          <head>
            <title>Example</title>
            <meta name="description" content="About this website">
          </head>
          </html>
        `,
      ),
      {
        type: null,
        title: 'Example',
        description: 'About this website',
        image: null,
        url: 'https://example.com',
      },
      'should parse out standard html <meta> tags',
    )
  })
  it('parses opengraph', () => {
    assert.deepEqual(
      parseOpengraph(
        'https://example.com',
        `
          <html>
          <head>
            <meta property="og:type" content="website">
            <meta property="og:title" content="Example">
            <meta property="og:description" content="About this website">
            <meta property="og:image" content="https://example.com/opengraph.png">
            <meta property="og:url" content="https://example.com/page/">
          </head>
          </html>
        `,
      ),
      {
        type: 'website',
        title: 'Example',
        description: 'About this website',
        image: 'https://example.com/opengraph.png',
        url: 'https://example.com/page/',
      },
      'should parse out OpenGraph <meta> tags',
    )
  })
  it('parses twitter', () => {
    assert.deepEqual(
      parseOpengraph(
        'https://example.com',
        `
          <html>
          <head>
            <meta name="twitter:title" content="Example">
            <meta name="twitter:description" content="About this website">
          </head>
          </html>
        `,
      ),
      {
        type: null,
        title: 'Example',
        description: 'About this website',
        image: null,
        url: 'https://example.com',
      },
      'should parse out Twitter <meta> tags',
    )
  })
  it('rebases images', () => {
    const result = parseOpengraph(
      'https://example.com',
      '<meta property="og:image" content="/opengraph.png">',
    )
    assert.equal(result.image, 'https://example.com/opengraph.png')
  })
})

import './details-utils.js'

const types = [
  {
    pattern: new URLPattern({ pathname: '/films/:slug/' }),
    href: (result) =>
      `https://github.com/robb-j/r0b-garden/blob/main/content/films/${result.pathname.groups.slug}.md?plain=1`,
  },
  {
    pattern: new URLPattern({ pathname: '/notes/tag/:slug/' }),
    href: (result) =>
      `https://github.com/robb-j/r0b-garden/blob/main/content/labels/${result.pathname.groups.slug}.md?plain=1`,
  },
  {
    pattern: new URLPattern({ pathname: '/notes/:slug/' }),
    href: (result) =>
      `https://github.com/robb-j/r0b-garden/blob/main/content/notes/${result.pathname.groups.slug}.md?plain=1`,
  },
  {
    pattern: new URLPattern({ pathname: '/photos/:slug/' }),
    href: (result) =>
      `https://github.com/robb-j/r0b-garden/blob/main/content/photos/${result.pathname.groups.slug}.md?plain=1`,
  },
  {
    pattern: new URLPattern({ pathname: '/tunes/:slug/' }),
    href: (result) =>
      `https://github.com/robb-j/r0b-garden/blob/main/content/tunes/${result.pathname.groups.slug}.md?plain=1`,
  },
]

window.addEventListener('keyup', (event) => {
  if (event.key !== '.') return
  if (!('URLPattern' in window)) return

  for (const type of types) {
    const result = type.pattern.exec(location.href)
    if (!result) continue
    location.href = type.href(result)
  }
})

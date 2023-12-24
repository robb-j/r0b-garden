export const shortDate = new Intl.DateTimeFormat('en-GB', {
  timeStyle: 'short',
  dateStyle: 'short',
  hour12: false,
})
export const longDate = new Intl.DateTimeFormat('en-GB', {
  timeStyle: 'short',
  dateStyle: 'medium',
  hour12: true,
})
export const monthAndYear = new Intl.DateTimeFormat('en-GB', {
  timeStyle: undefined,
  year: 'numeric',
  day: undefined,
  month: 'long',
})
export const dateOfMonth = new Intl.DateTimeFormat('en-GB', {
  timeStyle: undefined,
  dateStyle: undefined,
  day: 'numeric',
})

export const dateFilters = {
  shortDate(value) {
    return shortDate.format(new Date(value))
  },
  longDate(value) {
    return longDate.format(new Date(value))
  },
  monthAndYear(value) {
    return monthAndYear.format(new Date(value))
  },
  dateOfMonth(value) {
    return dateOfMonth.format(new Date(value))
  },
  dateOrdinal(value) {
    const date = new Date(value).getDate().toString()
    if (date.endsWith('1')) return 'st'
    if (date.endsWith('2')) return 'nd'
    if (date.endsWith('3')) return 'rd'
    return 'th'
  },
}

export default function datesPlugin(eleventyConfig) {
  for (const [name, fn] of Object.entries(dateFilters)) {
    eleventyConfig.addFilter(name, fn)
  }
}

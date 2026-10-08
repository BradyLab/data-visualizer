/**
 * Formats a date as "Month day year at time", e.g. "October 8 2026 at 3:45 PM".
 * Accepts a Date, ISO string, or epoch milliseconds. Uses the user's local time zone.
 * Returns an empty string if the input isn't a valid date.
 */
export function prettyDate(input: Date | string | number): string {
  const date = input instanceof Date ? input : new Date(input)
  if (isNaN(date.getTime())) return ''

  const month = date.toLocaleString('en-US', { month: 'long' })
  const time = date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })

  return `${month} ${date.getDate()}, ${date.getFullYear()} at ${time}`
}

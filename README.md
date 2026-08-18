# Wine Holidays Calendar

A subscribable calendar feed of wine holidays from around the world — grape days
(Malbec, Pinot Noir, Furmint), style days (orange wine, boxed wine, Champagne),
wine weeks and months, and traditional wine-country holidays like St Martin's Day
and Bulgaria's Trifon Zarezan.

84 entries. Subscribe once and they show up every year.

## Subscribe

**Feed URL:** https://wine-calendar.vercel.app/wine-holidays.ics

**Landing page:** https://wine-calendar.vercel.app

Also served from GitHub Pages, if you would rather point at the repo directly:
`https://ale-ayestaran-ai.github.io/wine-calendar/wine-holidays.ics`

Paste the feed URL into your calendar app:

- **Google Calendar** — Other calendars → + → From URL
- **Apple Calendar** — File → New Calendar Subscription
- **Outlook** — Add calendar → Subscribe from web

> Google caches subscribed feeds hard and can take 12–24h to show new entries.
> Apple lets you pick the refresh interval yourself.

## How it works

`wine-holidays.json` is the source of truth. `build.mjs` turns it into
`wine-holidays.ics`. No dependencies — plain Node.

```
node build.mjs      # regenerate the .ics
node verify.mjs     # check the output, print the year's calendar
node verify.mjs 2030
```

The clever bit is that almost nothing needs recomputing each year. iCal
recurrence rules can express both kinds of date natively:

| Rule type | Example | Becomes |
|---|---|---|
| `fixed` | World Malbec Day, 17 April | `FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=17` |
| `nth_weekday` | Grenache Day, 3rd Friday of September | `FREQ=YEARLY;BYMONTH=9;BYDAY=3FR` |
| `nth_weekday` (n: -1) | Carignan Day, last Thursday of October | `FREQ=YEARLY;BYMONTH=10;BYDAY=-1TH` |
| `month` | Virginia Wine Month | 31-day event, repeats yearly |

So the calendar app does the date math, and the file is good indefinitely.

Three entries can't be expressed as a recurrence rule and get written out one
year at a time (currently 25 years ahead):

- **International Chardonnay Day** — Thursday before US Memorial Day
- **International Cabernet Sauvignon Day** — Thursday before US Labor Day
- **English Wine Week** — 3rd Saturday of June through the last Sunday of June

These depend on *another* floating holiday, which RRULE has no way to reference.
Worth knowing: several blogs restate Cabernet Day as "first Thursday of
September", which is a drifted retelling — in 2028 the real date is 31 August,
a week earlier.

## Data quality

Every entry carries a `confidence` field, because wine holidays are largely
self-declared and the blog lists that catalogue them contradict each other.

- **high** — confirmed by the organising body, or a fixed traditional date
- **medium** — several independent calendars agree, no official organiser found
- **low** — sources disagree, or only one source found

Low-confidence entries get a warning line in their calendar description. Known
disputes are noted in each entry's `description`. The `sources` field records
where each date came from.

## Annual maintenance

Most entries need nothing. Check these each winter:

- **Prosecco Week** — sources give three different date ranges
- **Sparkling Wine Week** / **Drink Local Wine Week** — "first/second full week of"
  is never pinned down precisely
- Anything marked `"confidence": "low"`

## Adding a holiday

Add an object to `holidays` in `wine-holidays.json`, then run `node build.mjs`.
Give it a `slug` (used as the calendar UID, so don't change it later), a rule,
a `confidence`, and at least one source URL.

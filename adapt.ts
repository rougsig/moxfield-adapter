import {readCSVObjects, writeCSVObjects} from 'https://deno.land/x/csv/mod.ts'

type Card = {
  cn: number
  set: string
  lang: string
  foil: boolean
  etched: boolean
  preRelease: boolean
  promo: boolean
  count: number
}

const fingerprint = (card: Card) => {
  return [
    card.set,
    card.cn,
    card.lang,
    card.foil ? 'foil' : null,
    card.etched ? 'etched' : null,
    card.preRelease ? 'pre' : null,
    card.promo ? 'promo' : null,
  ].filter(it => it != null).join('__')
}

type CSVCard = {
  name: string
  number: string
  set: string
  lang: string
  foil: string
  etched: string
  'pre release': string
  promo: string
}

type MoxFieldCard = {
  Count: string
  Name: string
  Edition: string
  Condition: '' | 'M' | 'NM' | 'LP' | 'MP' | 'HP' | 'D'
  Language: '' | 'en' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'ja' | 'ko' | 'ru' | 'zhs' | 'zht' | 'he' | 'la' | 'grc' | 'ar' | 'sa' | 'ph'
  Foil: '' | 'foil' | 'etched'
  'Collector Number': string
  Alter: 'TRUE' | 'FALSE'
  Proxy: 'TRUE' | 'FALSE'
  'Purchase Price': string
}

const readCards = async () => {
  const cards: Card[] = []

  for await (const file of Deno.readDir('./binder')) {
    if (!file.name.endsWith('csv')) continue
    const f = await Deno.open(`./binder/${file.name}`)

    try {
      for await (const obj of readCSVObjects(f, {lineSeparator: '\r\n'})) {
        const card: CSVCard = obj
        cards.push({
          cn: card.number,
          set: card.set,
          lang: card.lang,
          foil: card.foil.trim().length > 0,
          etched: card.etched.trim().length > 0,
          preRelease: card['pre release'].trim().length > 0,
          promo: card.promo.trim().length > 0,
          count: 1,
        })
      }
    } finally {
      f.close()
    }
  }

  return cards
}

const mergeSameCards = (cards: Card[]) => {
  const result: Record<string, Card> = {}

  cards.forEach(card => {
    const fp = fingerprint(card)
    if (result[fp] != null) {
      result[fp].count += 1
    }
    else {
      result[fp] = card
    }
  })

  return result
}

const fetchCardCache = JSON.parse(Deno.readTextFileSync('./binder/scryfall.json'))
const fetchCardName = async (card: Card) => {
  const set = `${card.promo || card.preRelease ? 'p' : ''}${card.set}`
  let cn = `${card.cn}${card.promo ? 'p' : ''}${card.preRelease ? 's' : ''}`
  const key = () => `${set}__${cn}`
  try {
    if (fetchCardCache[key()]) return {
      name: fetchCardCache[key()],
      set: set,
      cn: cn,
    }
    console.log('fetch card', key())
    let resp = await fetch(`https://api.scryfall.com/cards/${set}/${cn}`)
    if (!resp.ok && (card.preRelease || card.promo)) {
      cn = `${card.cn}★` // old cards with star symbol
      if (fetchCardCache[key()]) return {
        name: fetchCardCache[key()],
        set: set,
        cn: cn,
      }
      resp = await fetch(`https://api.scryfall.com/cards/${set}/${cn}`)
    }
    const json = await resp.json()
    if (!resp.ok) throw new Error(JSON.stringify(json, null, 2))
    fetchCardCache[key()] = json.name
    return fetchCardCache[key()]
  } catch (e) {
    console.error(e)
    throw new Error(`problem with card ${key()}`)
  } finally {
    Deno.writeTextFileSync('./binder/scryfall.json', JSON.stringify(fetchCardCache, null, 2))
  }
}

for (const card of Object.values(mergeSameCards(await readCards()))) {
  const cards: MoxFieldCard[] = []
  const {name, cn, set} = await fetchCardName(card)
  cards.push({
    Count: card.count.toString(),
    Name: name,
    Edition: set,
    Condition: 'NM',
    Language: card.lang,
    Foil: (card.foil || card.preRelease) ? 'foil' : card.etched ? 'etched' : '',
    'Collector Number': cn,
    Alter: 'FALSE',
    Proxy: 'FALSE',
    'Purchase Price': '',
  })

  const f = await Deno.open(`./binder/merged.csv`, {
    write: true,
    create: true,
    append: true,
  })
  const asyncObjectsGenerator = async function* () {
    for (const card of cards) {
      yield card
    }
  }
  await writeCSVObjects(f, asyncObjectsGenerator(), {header: Object.keys(cards[0])})
  f.close()
}

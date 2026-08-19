import fs from 'node:fs/promises'
import path from 'node:path'
import * as cheerio from 'cheerio'

const OUT = path.resolve('public/data/lod-categories.json')
const BASE = 'https://lod.lu'
const SEEDS = [
  '/categories/category/GWS%20A1',
  '/categories/category/GWS%20A2',
  '/categories/category/FAMILL',
  '/categories/category/SCHOUL',
  '/categories/category/UEBST',
  '/categories/category/NOM-DE-PAYS',
  '/categories/category/PERSOUN',
  '/categories/category/BERUFFSBEZEECHNUNG',
  '/categories/category/GEMENG',
  '/categories/category/INTERJEKTIOUN',
  '/categories/category/FUSSBALL'
]
const USER_AGENT = 'LuxembourgishFlashcards/2.0 (+educational personal project; source: lod.lu)'
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return await r.text()
}
function abs(href, base=BASE) { try { return new URL(href, base).href } catch { return '' } }
function categoryCode(url) {
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean)
    const i = p.indexOf('category')
    return i >= 0 ? decodeURIComponent(p[i+1] || '') : ''
  } catch { return '' }
}
function clean(s='') { return s.replace(/\s+/g,' ').trim() }

async function sitemapUrls(url, seen = new Set()) {
  if (seen.has(url) || seen.size > 30) return []
  seen.add(url)
  try {
    const xml = await get(url)
    const $ = cheerio.load(xml, { xmlMode:true })
    const locs = $('loc').map((_,e)=>clean($(e).text())).get().filter(Boolean)
    const out = []
    for (const loc of locs) {
      if (/sitemap.*\.xml/i.test(loc)) out.push(...await sitemapUrls(loc, seen))
      else out.push(loc)
    }
    return out
  } catch { return [] }
}

export async function scrapeCategories({quiet=false}={}) {
  const discovered = new Set(SEEDS.map(x=>abs(x)))

  for (const sm of [`${BASE}/sitemap.xml`, `${BASE}/sitemap_index.xml`]) {
    for (const u of await sitemapUrls(sm)) if (u.includes('/categories/category/')) discovered.add(u.replace(/\/\d+\/?$/,''))
  }

  for (const start of [`${BASE}/categories`, `${BASE}/categories/`]) {
    try {
      const html=await get(start), $=cheerio.load(html)
      $('a[href*="/categories/category/"]').each((_,a)=>discovered.add(abs($(a).attr('href'),start).replace(/\/\d+\/?$/,'')))
    } catch {}
  }

  const result=[]
  const seenBases=new Set()
  for (const raw of discovered) {
    const base=raw.replace(/\/\d+\/?$/,'')
    if (seenBases.has(base)) continue
    seenBases.add(base)
    const code=categoryCode(base)
    if (!code) continue
    const words=new Map()
    let name=code
    let description=''
    const pageSeen=new Set(), queue=[base]

    while(queue.length && pageSeen.size < 250) {
      const url=queue.shift(); if(pageSeen.has(url)) continue; pageSeen.add(url)
      try {
        const html=await get(url); const $=cheerio.load(html)
        const title=clean($('h1').first().text() || $('title').text().split('|')[0])
        if(title) name=title
        const p=clean($('main p').first().text() || $('.category-description').first().text())
        if(p && p.length < 600) description=p

        $('a').each((_,a)=>{
          const href=abs($(a).attr('href'),url), txt=clean($(a).text())
          if (!href) return
          if (href.includes('/artikel/') && txt && txt.length < 100) {
            const m=href.match(/\/artikel\/([^/?#]+)/)
            if(m) words.set(m[1].toUpperCase(), txt)
          }
          if (href.includes(`/categories/category/${encodeURIComponent(code)}`) || href.includes(`/categories/category/${code}`)) {
            if (/\/\d+\/?(?:\?|#|$)/.test(href) && !pageSeen.has(href)) queue.push(href)
          }
          if (href.includes('/categories/category/')) discovered.add(href.replace(/\/\d+\/?$/,''))
        })
        await sleep(80)
      } catch {}
    }
    if(words.size || ['GWS A1','GWS A2'].includes(code)) result.push({code,name,description,words:Object.fromEntries(words)})
    if(!quiet) console.log(`${code}: ${name} — ${words.size} entries`)
  }

  result.sort((a,b)=>a.name.localeCompare(b.name,'lb'))
  await fs.mkdir(path.dirname(OUT),{recursive:true})
  await fs.writeFile(OUT,JSON.stringify(result,null,2))
  return result
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  scrapeCategories().catch(e=>{console.error(e);process.exit(1)})
}

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import AdmZip from 'adm-zip'
import { XMLParser } from 'fast-xml-parser'
import { scrapeCategories } from './scrape-categories.mjs'

const DATASET_API='https://data.public.lu/api/1/datasets/letzebuerger-online-dictionnaire-lod-linguistesch-daten/'
const FALLBACK_ZIP='https://download.data.public.lu/resources/letzebuerger-online-dictionnaire-lod-linguistesch-daten/20260727-095857/260727-new-lod-art.zip'
const COMMON_1000='https://raw.githubusercontent.com/bukowa/1000-common-words/master/Luxembourgish-1000-common.txt'
const OUT=path.resolve('public/data/lod-cards.json')
const META=path.resolve('public/data/lod-meta.json')
const USER_AGENT='LuxembourgishFlashcards/2.0 (+educational personal project; source: lod.lu)'

const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',removeNSPrefix:true,trimValues:true,parseTagValue:false,processEntities:true})
const arr=v=>v==null?[]:Array.isArray(v)?v:[v]
const clean=s=>String(s??'').replace(/\s+/g,' ').trim()
function text(v){
  if(v==null)return ''
  if(['string','number','boolean'].includes(typeof v))return clean(v)
  if(Array.isArray(v))return v.map(text).filter(Boolean).join('; ')
  if(typeof v==='object'){
    if(v['#text']!=null)return text(v['#text'])
    return Object.entries(v).filter(([k])=>!k.startsWith('@_')).map(([,x])=>text(x)).filter(Boolean).join('; ')
  }
  return ''
}
function walk(node,fn){ if(!node||typeof node!=='object')return; fn(node); for(const v of Object.values(node)) for(const x of arr(v)) if(x&&typeof x==='object') walk(x,fn) }
function uniq(items){const s=new Set(),o=[];for(const x of items.flatMap(v=>String(v||'').split(/\s*;\s*/))){const c=clean(x);if(c&&!s.has(c.toLowerCase())){s.add(c.toLowerCase());o.push(c)}}return o}
function collect(node,pred){const o=[];walk(node,n=>{for(const [k,v] of Object.entries(n)){if(pred(k,v,n)){const t=text(v);if(t)o.push(t)}}});return uniq(o)}
function attrLang(n){return String(n?.['@_lang']||n?.['@_xml:lang']||n?.['@_language']||'').toLowerCase()}

function entryCandidates(doc){
  const out=[]
  walk(doc,n=>{
    const id=clean(n['@_id']||n.id)
    if(!id)return
    const keys=Object.keys(n).map(x=>x.toLowerCase())
    if(keys.some(k=>k.includes('lemma')||k.includes('adresse')||k.includes('spelling')||k==='form'||k==='orth')) out.push(n)
  })
  return out
}
function extractLb(n){
  const exact=collect(n,k=>/^(item-adresse|lemma|spelling|orth|headword|forme?)$/i.test(k))
  return exact[0]||''
}
function extractEnglish(n){
  const direct=collect(n,k=>/(trad.*en|en.*trad|english|translation.*en|equiv.*en)/i.test(k))
  const lang=[]
  walk(n,x=>{
    const l=attrLang(x)
    if(['en','eng','english'].includes(l)){
      const t=text(x); if(t)lang.push(t)
    }
  })
  return uniq([...direct,...lang]).join('; ')
}
function extractIpa(n){
  const xs=collect(n,k=>/(ipa|phonetic|phonetik|pronunciation|transcription|transkrip)/i.test(k))
  return xs.slice(0,4).join(' · ')
}
function extractPos(n){
  const raw=collect(n,k=>/(part.of.speech|pos|grammat|wordclass|wortart|catgram)/i.test(k)).join(' ').toLowerCase()
  const keyBlob=(()=>{const a=[];walk(n,x=>a.push(...Object.keys(x)));return a.join(' ').toLowerCase()})()
  const s=raw+' '+keyBlob
  if(/\bverb|verbe|vrb\b/.test(s))return 'Verb'
  if(/\bnoun|substantiv|subst\b|nom\b/.test(s))return 'Noun'
  if(/\badject|adjektiv|adj\b/.test(s))return 'Adjective'
  if(/\badverb|adv\b/.test(s))return 'Adverb'
  if(/\bpronoun|pronomen|pron\b/.test(s))return 'Pronoun'
  if(/\bpreposition|präposition|prep\b/.test(s))return 'Preposition'
  if(/\bconjunction|konjunktion|conj\b/.test(s))return 'Conjunction'
  if(/\binterjection|interjektioun|interj\b/.test(s))return 'Interjection'
  return ''
}

function decodeXml(s){
  return String(s??'')
    .replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16)))
    .replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(parseInt(d,10)))
    .replace(/&apos;/g,"'")
    .replace(/&quot;/g,'"')
    .replace(/&gt;/g,'>')
    .replace(/&lt;/g,'<')
    .replace(/&amp;/g,'&')
}
function xmlText(fragment){
  return clean(decodeXml(
    String(fragment??'')
      .replace(/<[^>]+>/g,' ')
  ).replace(/\s+([,.;:!?])/g,'$1'))
}

// LOD examples are explicitly represented in the official XML as:
// <example id="…"><text>…</text><gloss>…</gloss></example>
// We only import the <text> value. This deliberately avoids guessing from
// generic fields such as labels/keywords, which can produce false examples.
function examplesFromXml(xml){
  const out=new Map()
  const itemRe=/<(?:[A-Za-z0-9_-]+:)?ITEM\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?ITEM>/gi
  for(const m of String(xml).matchAll(itemRe)){
    const block=m[0]
    const meta=block.match(/<(?:[A-Za-z0-9_-]+:)?META\b[^>]*\b(?:[A-Za-z0-9_-]+:)?ID=["']([^"']+)["'][^>]*\/?\s*>/i)
    if(!meta)continue
    const id=clean(meta[1])
    const examples=[]
    const exRe=/<(?:[A-Za-z0-9_-]+:)?example\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?example>/gi
    for(const exm of block.matchAll(exRe)){
      const ex=exm[0]
      const tm=ex.match(/<(?:[A-Za-z0-9_-]+:)?text\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?text>/i)
      if(!tm)continue
      const sentence=xmlText(tm[1])
      if(sentence && sentence.length>=3)examples.push(sentence)
    }
    if(examples.length)out.set(id.toLowerCase(),uniq(examples).slice(0,6))
  }
  return out
}

function extractExamples(n){
  // JSON sources/fallback: only accept a literal <example>.text-like structure.
  const found=[]
  walk(n,node=>{
    for(const [k,v] of Object.entries(node)){
      if(!/^example$/i.test(k))continue
      for(const ex of arr(v)){
        if(!ex||typeof ex!=='object')continue
        const tk=Object.keys(ex).find(x=>/^text$/i.test(x))
        if(!tk)continue
        const sentence=clean(text(ex[tk]).replace(/\s*;\s*/g,' '))
        if(sentence)found.push(sentence)
      }
    }
  })
  return uniq(found).slice(0,6)
}

function embeddedCategories(n){
  const vals=collect(n,k=>/(category|categorie|kategorie|thema|theme|rubrik|list)/i.test(k))
  return uniq(vals.filter(x=>x.length<100)).slice(0,20)
}
function extract(doc){
  return entryCandidates(doc).map(n=>{
    const id=clean(n['@_id']||n.id), lb=extractLb(n), en=extractEnglish(n)
    return {id,lb,en,ipa:extractIpa(n),pos:extractPos(n),examples:extractExamples(n),embeddedCategories:embeddedCategories(n)}
  }).filter(x=>x.id&&x.lb&&x.en)
}

async function latestZip(){
  try{
    const r=await fetch(DATASET_API,{headers:{accept:'application/json','user-agent':USER_AGENT}});if(!r.ok)throw 0
    const d=await r.json();const rs=(d.resources||[]).filter(x=>/new-lod-art\.zip/i.test(`${x.title||''} ${x.url||''}`))
    rs.sort((a,b)=>String(b.last_modified||b.created_at||'').localeCompare(String(a.last_modified||a.created_at||'')))
    return rs[0]?.url||FALLBACK_ZIP
  }catch{return FALLBACK_ZIP}
}
async function download(url,file){
  const r=await fetch(url,{headers:{'user-agent':USER_AGENT}});if(!r.ok)throw new Error(`Dataset download failed: ${r.status}`)
  await fs.writeFile(file,Buffer.from(await r.arrayBuffer()))
}
async function common1000(){
  try{const r=await fetch(COMMON_1000,{headers:{'user-agent':USER_AGENT}});if(!r.ok)return new Set();return new Set((await r.text()).split(/\r?\n/).map(x=>clean(x).toLowerCase()).filter(Boolean))}catch{return new Set()}
}

const studyRules={
  Family:{codes:['FAMILL'],words:['family','mother','father','parent','child','son','daughter','brother','sister','husband','wife','grandmother','grandfather','uncle','aunt','cousin','baby','marriage']},
  Travel:{codes:['NOM-DE-PAYS'],words:['travel','trip','journey','airport','plane','flight','hotel','passport','luggage','holiday','vacation','tourist','border']},
  Work:{codes:['BERUFFSBEZEECHNUNG'],words:['work','job','office','company','business','employee','employer','colleague','career','profession','salary','meeting','manager','worker','customer','project']},
  Food:{codes:['UEBST'],words:['food','eat','drink','bread','milk','water','coffee','tea','meat','fish','fruit','vegetable','restaurant','breakfast','lunch','dinner','cheese','egg']},
  Home:{codes:[],words:['home','house','apartment','room','door','window','bed','chair','table','bathroom','kitchen','garden','garage','roof','floor','wall','rent']},
  Health:{codes:[],words:['health','doctor','hospital','medicine','pain','sick','ill','disease','tooth','body','blood','heart','head','hand','foot','eye','ear','nurse','pharmacy']},
  School:{codes:['SCHOUL'],words:['school','teacher','student','pupil','lesson','class','book','learn','study','exam','university','education','homework','course']},
  Shopping:{codes:[],words:['shop','shopping','store','buy','sell','price','money','cash','market','cost','cheap','expensive','pay','bill']},
  Time:{codes:[],words:['time','day','week','month','year','hour','minute','morning','evening','night','today','tomorrow','yesterday']},
  Nature:{codes:[],words:['nature','tree','flower','forest','river','mountain','animal','sun','moon','rain','snow','weather','sea','lake','earth','sky']},
  People:{codes:['PERSOUN'],words:['person','people','man','woman','boy','girl','friend','neighbor','neighbour','name','age']},
  Transport:{codes:[],words:['car','bus','train','tram','taxi','bicycle','bike','motorcycle','station','ticket','road','street','drive','transport']},
  Sports:{codes:['FUSSBALL'],words:['sport','football','soccer','game','player','team','ball','match','run','swim']}
}
function wordHit(en,words){const s=` ${en.toLowerCase().replace(/[^a-z]+/g,' ')} `;return words.some(w=>s.includes(` ${w} `))}

async function main(){
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'lodfc-')), z=path.join(tmp,'lod.zip'), dir=path.join(tmp,'data')
  const url=await latestZip();console.log('Official LOD dataset:',url);await download(url,z);new AdmZip(z).extractAllTo(dir,true)
  const files=[];async function scan(d){for(const e of await fs.readdir(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())await scan(p);else if(/\.(xml|json)$/i.test(e.name))files.push(p)}}await scan(dir)
  console.log(`Parsing ${files.length} source files…`)
  const raw=[]
  for(const f of files){
    try{
      const s=await fs.readFile(f,'utf8')
      const isJson=f.endsWith('.json')
      const parsed=extract(isJson?JSON.parse(s):parser.parse(s))
      if(!isJson){
        const exactExamples=examplesFromXml(s)
        for(const entry of parsed){
          const ex=exactExamples.get(entry.id.toLowerCase())
          if(ex?.length)entry.examples=ex
        }
      }
      raw.push(...parsed)
    }catch(e){console.warn('Skipped',path.basename(f),e.message)}
  }
  const byId=new Map()
  for(const c of raw){const k=c.id.toLowerCase();if(!byId.has(k))byId.set(k,c);else{const o=byId.get(k);o.en=uniq([o.en,c.en]).join('; ');o.ipa=o.ipa||c.ipa;o.pos=o.pos||c.pos;o.examples=uniq([...(o.examples||[]),...(c.examples||[])]).slice(0,6);o.embeddedCategories=uniq([...o.embeddedCategories,...c.embeddedCategories])}}

  console.log('Discovering/scraping official LOD category pages…')
  let cats=[];try{cats=await scrapeCategories({quiet:true})}catch(e){console.warn('Category scrape unavailable:',e.message)}
  const catByEntry=new Map(), catByName=new Map()
  for(const c of cats){catByName.set(c.code,c);for(const [entryId] of Object.entries(c.words||{})){const k=entryId.toLowerCase();if(!catByEntry.has(k))catByEntry.set(k,[]);catByEntry.get(k).push({code:c.code,name:c.name})}}

  const common=await common1000()
  const a1Ids=new Set(Object.keys(catByName.get('GWS A1')?.words||{}).map(x=>x.toLowerCase()))
  const a2Ids=new Set(Object.keys(catByName.get('GWS A2')?.words||{}).map(x=>x.toLowerCase()))
  const a1Words=new Set(Object.values(catByName.get('GWS A1')?.words||{}).map(x=>x.toLowerCase()))
  const a2Words=new Set(Object.values(catByName.get('GWS A2')?.words||{}).map(x=>x.toLowerCase()))

  const cards=[...byId.values()].map(c=>{
    const k=c.id.toLowerCase(), lw=c.lb.toLowerCase(), lodCategories=catByEntry.get(k)||[]
    const levels=[]
    if(a1Ids.has(k)||a1Words.has(lw))levels.push('A1')
    if(a2Ids.has(k)||a2Words.has(lw))levels.push('A2')
    if(!levels.length&&common.has(lw))levels.push('B1')
    const codes=new Set(lodCategories.map(x=>x.code))
    const studyTopics=[]
    for(const [topic,r] of Object.entries(studyRules)) if(r.codes.some(x=>codes.has(x))||wordHit(c.en,r.words)) studyTopics.push(topic)
    if(c.pos==='Verb')studyTopics.push('Verbs')
    if(c.pos==='Noun')studyTopics.push('Nouns')
    if(c.pos==='Adjective')studyTopics.push('Adjectives')
    return {
      id:c.id,lb:c.lb,en:c.en,ipa:c.ipa,pos:c.pos,examples:c.examples||[],levels:[...new Set(levels)],studyTopics:[...new Set(studyTopics)],lodCategories,
      audioUrl:`https://lod.lu/uploads/OGG/${c.id.toLowerCase()}.ogg`,
      audioFallback:`https://lod.lu/uploads/AAC/${c.id.toLowerCase()}.m4a`,
      lodUrl:`https://lod.lu/artikel/${encodeURIComponent(c.id.toUpperCase())}`
    }
  }).sort((a,b)=>a.lb.localeCompare(b.lb,'lb'))
  await fs.mkdir(path.dirname(OUT),{recursive:true});await fs.writeFile(OUT,JSON.stringify(cards))
  const meta={generatedAt:new Date().toISOString(),datasetUrl:url,total:cards.length,categoryCount:cats.length,a1:cards.filter(x=>x.levels.includes('A1')).length,a2:cards.filter(x=>x.levels.includes('A2')).length,b1StudyGroup:cards.filter(x=>x.levels.includes('B1')).length,audioCount:cards.length,phoneticCount:cards.filter(x=>x.ipa).length,exampleCount:cards.filter(x=>x.examples?.length).length,notes:[
    'A1 and A2 are sourced from official LOD category pages when reachable.',
    'B1 is not an official LOD category in the supplied resources; it is a study grouping based on the supplied 1000-common-words list after excluding A1/A2.',
    'Audio URLs are official LOD URLs derived from the entry ID. The UI preloads each file and hides the audio button if LOD does not return playable audio. No TTS is used.',
    'Usage examples are extracted from the official LOD open-data article content and shown only after Reveal. No generated example sentences are used.',
    'Topic chips prefer official LOD thematic category membership; English-meaning keyword rules fill gaps for the broad learner topics.'
  ]}
  await fs.writeFile(META,JSON.stringify(meta,null,2));console.log(meta)
}
main().catch(e=>{console.error(e);process.exit(1)})

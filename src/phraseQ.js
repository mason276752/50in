// 短句這一次怎麼出：帶入變數、組選項；挖空、回應題組出題目
// 資料（data/phrase-ext.json，scripts/build-phrases.mjs 產生），每個短句原文對到：
//   t：句子切成段，數字是第幾個變數，其他是振假名段 [[文字, 讀音?], …]
//   z：中文切成段，數字是第幾個變數
//   s：每個變數的值 [[振假名段, 中文], …]
//   c：挖空題 { b: [從 t 的第幾段, 到第幾段), a: 答案說明, w: 錯誤選項 [[振假名段, 說明, 1?]] } 或 { b, star: 1 }（挖掉變數）
//   r：回應題 { who: 角色, p: 對方說的話（振假名段）, pz: 中文, w: 錯誤回應 [[振假名段, 中文, 1?]] }
import { makeChoices, baseKey } from './words'

const pick = (a) => a[Math.floor(Math.random() * a.length)]
function shuffle(list) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
// 相鄰假名段合併（變數接上前後文之後）
function joinSegs(parts) {
  const out = []
  for (const s of parts.flat()) {
    if (!s[1] && out.length && !out.at(-1)[1]) out.at(-1)[0] += s[0]
    else out.push([...s])
  }
  return out
}
const wordOf = (furi) => ({ furi, ja: furi.map((s) => s[0]).join(''), kana: furi.map((s) => s[1] || s[0]).join('') })

// 每個變數挑一個值（vals 沒給就隨機）→ 帶入後的短句；id 跟原句一樣，學習紀錄算在原句
export function instantiate(item, vals) {
  const e = item.ext
  if (!e?.s) return item
  vals ||= e.s.map((v) => Math.floor(Math.random() * v.length))
  const furi = joinSegs(e.t.map((p) => (typeof p === 'number' ? e.s[p][vals[p]][0] : p)))
  const w = wordOf(furi)
  const zh = e.z.map((p) => (typeof p === 'number' ? e.s[p][vals[p]][1] : p)).join('')
  return { ...item, ...w, zh, display: w.kana, caption: zh, say: w.kana, bk: baseKey(item), vals }
}

// 換掉其中一個變數的值（錯誤選項用：同一句、數字或地點不一樣，要真的看懂才選得對）
function otherVals(item, vals) {
  const s = item.ext.s
  const k = Math.floor(Math.random() * s.length)
  const choices = s[k].map((_, i) => i).filter((i) => i !== vals[k])
  if (!choices.length) return null
  const out = [...vals]
  out[k] = pick(choices)
  return out
}

// 同一個短句的挖空題輪流出：全部出過一輪才重新打亂
const decks = new Map()
function nextOf(id, list) {
  const d = decks.get(id) || { left: [], last: -1 }
  decks.set(id, d)
  if (!d.left.length) {
    d.left = shuffle(list.map((_, i) => i))
    if (d.left.length > 1 && d.left[0] === d.last) d.left.push(d.left.shift())
  }
  d.last = d.left.shift()
  return list[d.last]
}

// 回傳 { cur: 這次的短句（帶入變數後）, q: 挖空／回應題（日→中、中→日沒有）, options }
// 選項的 id 等於題目 id 的就是答案（App 用 id 判斷答對）
export function makePhraseCard(item, confused) {
  const cur = instantiate(item)
  if (item.dir === 'cloze') return { cur, ...clozeQ(item, cur) }
  if (item.dir === 'reply') return { cur, ...replyQ(item, cur) }
  // 日→中、中→日：錯誤選項是別的短句（有變數的也隨機帶入），有變數的再放一個「同一句、值不一樣」的
  const others = makeChoices(item, confused)
    .filter((w) => w !== item)
    .map((w) => instantiate(w))
  if (cur.vals) {
    const vals = otherVals(item, cur.vals)
    if (vals) others.splice(Math.floor(Math.random() * others.length), 1, { ...instantiate(item, vals), id: `${item.id}#v`, variant: true })
  }
  return { cur, q: null, options: shuffle([cur, ...others]) }
}

function clozeQ(item, cur) {
  const e = item.ext
  const c = nextOf(item.id, e.c)
  const t = e.t || [cur.furi]
  // 帶入變數後的每一段
  const parts = t.map((p) => (typeof p === 'number' ? e.s[p][cur.vals[p]][0] : p))
  const before = wordOf(joinSegs(parts.slice(0, c.b[0])))
  const answer = wordOf(joinSegs(parts.slice(c.b[0], c.b[1])))
  const after = wordOf(joinSegs(parts.slice(c.b[1])))
  let answerZh = c.a
  let wrong
  if (c.star) {
    // 挖掉變數：錯誤選項是這個變數的其他值，中文那句寫的是哪個值就選哪個
    const k = t[c.b[0]]
    const values = e.s[k]
    answerZh = values[cur.vals[k]][1]
    wrong = shuffle(values.filter((_, i) => i !== cur.vals[k])).map(([furi, zh]) => [furi, zh])
  } else wrong = shuffle(c.w)
  const options = shuffle([
    { id: item.id, ...answer, zh: answerZh },
    ...wrong.slice(0, 3).map(([furi, zh, bad]) => ({ ...wordOf(furi), id: `${item.id}#${wordOf(furi).ja}`, zh, fake: !!bad })),
  ])
  return { q: { kind: 'cloze', before, answer, after, zh: cur.zh, kana: cur.kana }, options }
}

function replyQ(item, cur) {
  const r = nextOf(item.id, item.ext.r)
  const prompt = wordOf(r.p)
  const options = shuffle([
    { id: item.id, ...wordOf(cur.furi || [[cur.ja]]), zh: cur.zh },
    ...shuffle(r.w)
      .slice(0, 3)
      .map(([furi, zh, bad]) => ({ ...wordOf(furi), id: `${item.id}#${wordOf(furi).ja}`, zh, fake: !!bad })),
  ])
  return { q: { kind: 'reply', who: r.who, prompt, promptZh: r.pz, answer: cur, kana: prompt.kana }, options }
}

// 振假名對齊（會話、語法題庫共用）
// 用單字庫、短句庫已經切好的振假名，整理出每個漢字的讀音，再拿來對齊句子的原文和讀音（含連濁、促音）
import fs from 'node:fs'
import path from 'node:path'

export const ROOT = path.resolve(import.meta.dirname, '../..')
export const KANJI = /[一-鿿々〆〇]/
const PUNCT = /([、。！？…・ 「」『』〜～（）()])/

export const hira = (s) => [...s].map((c) => (c >= 'ァ' && c <= 'ヶ' ? String.fromCharCode(c.charCodeAt(0) - 0x60) : c)).join('')

// ---- 讀音資料 ----
export const readCount = new Map() // 單一漢字 → Map(讀音 → 次數)
export const groupRead = new Map() // 多字詞（熟字訓、整段）→ Set(讀音)
export const vocab = []
function addRead(map, key, rt) {
  if (!map.has(key)) map.set(key, new Map())
  const m = map.get(key)
  m.set(rt, (m.get(rt) || 0) + 1)
}
for (const file of ['vocab.tsv', 'phrases.tsv']) {
  for (const line of fs
    .readFileSync(path.join(ROOT, 'src/data', file), 'utf8')
    .trim()
    .split('\n')) {
    const [level, group, pos, ja, reading, zh, en, furi] = line.split('\t')
    const kana = reading || ja
    if (file === 'vocab.tsv') vocab.push({ level: +level, pos, ja, kana, zh })
    if (KANJI.test(ja)) addRead(groupRead, ja, hira(kana))
    for (const seg of (furi || '').split('|')) {
      const [t, rt] = seg.split('=')
      if (!rt) continue
      if ([...t].length === 1) addRead(readCount, t, hira(rt))
      else addRead(groupRead, t, hira(rt))
    }
  }
}
// 人名、專有名詞、資料裡沒有的固定讀法
const MANUAL = `佐藤=さとう 美咲=みさき 山手=やまのて 彩=あや 李=り 〇=まる 取引=とりひき
  藤=とう 吉=よし 本=もと 伊=い 井上=いのうえ 清水=しみず 岡=おか 黄=こう 劉=りゅう 呉=ご 蔡=さい 楊=よう
  太=た 翔=しょう 輔=すけ 也=や 亮=りょう 樹=き 隆=たかし 美=み 恵=めぐみ 尋=ひろ 千=ち
  渋=しぶ 谷=や 奈=な 良=ら 沢=さわ 神戸=こうべ 韓=かん 緑=りょく 丼=どん 斗=と 北=ほく 魚=ざかな 唐=から 厨=ちゅう 却=きゃく 詣=もうで 窓=そう 炊=だ 麺=めん 見積=みつもり 竜=りゅう 作=づく 引=び 佐々木=ささき 荷=か 声=ごえ 香港=ほんこん 懐=かい 人々=ひとびと 唐辛子=とうがらし`
  .split(/\s+/)
  .map((x) => x.split('='))
for (const [k, v] of MANUAL) {
  if ([...k].length === 1) addRead(readCount, k, v)
  else addRead(groupRead, k, v)
}
const VOICE = Object.fromEntries([...'かきくけこさしすせそたちつてとはひふへほ'].map((c, i) => [c, 'がぎぐげござじずぜぞだぢづでどばびぶべぼ'[i]]))
const HANDAKU = Object.fromEntries([...'はひふへほ'].map((c, i) => [c, 'ぱぴぷぺぽ'[i]]))
// 某個漢字可能的讀音：原讀音、連濁（ひと→びと）、半濁（ほん→ぽん）、促音（いち→いっ）
function readingsOf(c, first) {
  const out = new Map()
  for (const [r, n] of readCount.get(c) || []) {
    const score = 2 + Math.min(n, 30) / 30
    out.set(r, Math.max(out.get(r) || 0, score))
    const alt = (x) => out.set(x, Math.max(out.get(x) || 0, 1.5))
    if (!first && VOICE[r[0]]) alt(VOICE[r[0]] + r.slice(1))
    if (!first && HANDAKU[r[0]]) alt(HANDAKU[r[0]] + r.slice(1))
    if (/[つくちき]$/.test(r) && r.length > 1) alt(r.slice(0, -1) + 'っ')
  }
  return out
}
// 漢字串逐字對讀音；對不上回傳 null
export function splitRun(run, rd) {
  const chars = [...run]
  const memo = new Map()
  const go = (i, pos) => {
    const key = i + ':' + pos
    if (memo.has(key)) return memo.get(key)
    let best = null
    if (i === chars.length) best = pos === rd.length ? { score: 0, segs: [] } : null
    else {
      for (const [r, n] of readingsOf(chars[i], i === 0)) {
        if (!rd.startsWith(r, pos)) continue
        const rest = go(i + 1, pos + r.length)
        if (rest && (!best || rest.score + n > best.score)) best = { score: rest.score + n, segs: [[chars[i], r], ...rest.segs] }
      }
      // 資料裡沒有這個字的這種讀音（三年間 的 間＝かん）：只讓這一個字猜讀音（扣分、記警告），其他字照常逐字標
      for (let len = 1; len <= 4 && pos + len <= rd.length; len++) {
        const rest = go(i + 1, pos + len)
        if (rest && (!best || rest.score - 8 > best.score))
          best = {
            score: rest.score - 8,
            segs: [[chars[i], rd.slice(pos, pos + len), 'guess'], ...rest.segs],
          }
      }
      // 熟字訓、整詞讀音（明日＝あした、日本＝にほん）當一個單位：明日会おう、日本人
      for (let j = i + 2; j <= chars.length; j++) {
        const word = chars.slice(i, j).join('')
        for (const r of groupRead.get(word)?.keys() || []) {
          if (!rd.startsWith(r, pos)) continue
          const rest = go(j, pos + r.length)
          const sc = rest && rest.score + 2.5 * (j - i)
          if (rest && (!best || sc > best.score)) best = { score: sc, segs: [[word, r], ...rest.segs] }
        }
      }
    }
    memo.set(key, best)
    return best
  }
  return go(0, 0)
}
// 一段（沒有標點）的對齊：假名當錨點，列舉每段漢字可能對應的讀音，挑分數最高的切法
function alignPiece(ja, kana) {
  const runs = ja.match(/[一-鿿々〆〇]+|[^一-鿿々〆〇]+/g) || []
  const k = hira(kana)
  let best = null
  const go = (i, pos, acc, score) => {
    if (i === runs.length) {
      if (pos === k.length && (!best || score > best.score)) best = { score, segs: acc }
      return
    }
    const r = runs[i]
    if (!KANJI.test(r)) {
      if (k.startsWith(hira(r), pos)) go(i + 1, pos + r.length, [...acc, [r]], score)
      return
    }
    for (let end = pos + 1; end <= Math.min(k.length, pos + 4 * [...r].length + 2); end++) {
      const rd = k.slice(pos, end)
      const split = splitRun(r, rd)
      if (split) go(i + 1, end, [...acc, ...split.segs], score + 10 + Math.min(split.score, 5) + (split.score < 0 ? split.score : 0))
      else if (groupRead.get(r)?.has(rd)) go(i + 1, end, [...acc, [r, rd]], score + 9)
      else go(i + 1, end, [...acc, [r, rd]], score - 20) // 整段標（熟字訓、資料裡沒有的讀音）
    }
  }
  go(0, 0, [], 0)
  return best
}
// 原文、讀音標點對標點切開再對齊；回傳 [[文字, 讀音?], …]
export function align(ja, kana, where, warn = () => {}) {
  if (!KANJI.test(ja)) {
    if (kana && hira(kana) !== hira(ja)) throw new Error(`${where}：沒有漢字，讀音卻不一樣「${ja}」/「${kana}」`)
    return [[ja]]
  }
  if (!kana || kana === ja) throw new Error(`${where}：「${ja}」有漢字要寫讀音`)
  const jp = ja.split(PUNCT)
  const kp = kana.split(PUNCT)
  if (jp.length !== kp.length) throw new Error(`${where}：原文和讀音的標點對不上\n  ${ja}\n  ${kana}`)
  const segs = []
  jp.forEach((a, i) => {
    if (!a) return
    if (!KANJI.test(a)) {
      if (hira(a) !== hira(kp[i])) throw new Error(`${where}：假名不一致「${a}」/「${kp[i]}」`)
      return segs.push([a])
    }
    const r = alignPiece(a, kp[i])
    if (!r) throw new Error(`${where}：讀音對不上「${a}」/「${kp[i]}」`)
    const guessed = r.segs.filter((s) => s[2] === 'guess').map((s) => `${s[0]}=${s[1]}`)
    if (guessed.length) warn(`${where}：「${a}」用猜的讀音 ${guessed.join(' ')}`)
    const grouped = r.segs.filter((s) => s[1] && [...s[0]].length > 1 && !groupRead.get(s[0])?.has(hira(s[1])))
    if (grouped.length) warn(`${where}：「${a}」整段標讀音 ${grouped.map((s) => `${s[0]}=${s[1]}`).join(' ')}`)
    segs.push(...r.segs.map((s) => s.slice(0, 2)))
  })
  // 相鄰假名段合併
  const out = []
  for (const s of segs) {
    if (!s[1] && out.length && !out.at(-1)[1]) out.at(-1)[0] += s[0]
    else out.push([...s])
  }
  return out
}

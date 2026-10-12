// 題庫原始檔共用的振假名寫法：漢字後面直接標讀音（毎朝(まいあさ)），用單字庫的讀音逐字對齊、順便檢查有沒有標錯
// 語法（build-grammar.mjs）、短句的挖空／回應題（build-phrases.mjs）都用這套
import fs from 'node:fs'
import { hira, splitRun, groupRead } from './furigana.mjs'

const RUN = /[0-9０-９一-鿿々〆〇]/
export const KANJI = /[一-鿿々〆〇]/
// 来る的讀音看後面接什麼：来ます・来た・来て＝き、来ない・来よう・来られる・来させる・来い＝こ、来る・来れば＝く
const KURU = { ま: 'き', た: 'き', て: 'き', な: 'こ', よ: 'こ', ら: 'こ', さ: 'こ', い: 'こ', る: 'く', れ: 'く' }

// 單字庫沒有、但確定正確的讀法
export const MANUAL = new Set(
  `一人=ひとり 納豆=なっとう 我=わ 偽物=にせもの 寿司=すし 豆腐=とうふ 堪=た 否=いな 忍=しの 難=かた 形見=かたみ 完璧=かんぺき 喫煙=きつえん 忘年会=ぼうねんかい`.split(/\s+/),
)

// 一個漢字詞 + 讀音 → 振假名段：逐字對得上就逐字標，熟字訓（今日＝きょう）整段標，對不上就是讀音寫錯了
function rubySegs(run, rt, where) {
  if (/[0-9０-９]/.test(run)) return [[run, rt]] // 數字（7時＝しちじ）整段標
  const r = splitRun(run, hira(rt))
  if (r && !r.segs.some((s) => s[2])) return r.segs.map((s) => s.slice(0, 2))
  if (groupRead.get(run)?.has(hira(rt))) return [[run, rt]]
  if (MANUAL.has(`${run}=${rt}`)) return [[run, rt]]
  throw new Error(`${where}：「${run}(${rt})」讀音對不上單字庫，確定沒寫錯的話加進 scripts/lib/ruby.mjs 的 MANUAL`)
}

// 相鄰假名段合併
export function mergeKana(segs) {
  const out = []
  for (const s of segs) {
    if (!s[1] && out.length && !out.at(-1)[1]) out.at(-1)[0] += s[0]
    else out.push([...s])
  }
  return out
}

// 「毎朝(まいあさ)7時(しちじ)に」→ [['毎','まい'],['朝','あさ'],['7時','しちじ'],['に']]
// ctx：同一句其他地方標過的讀音（選項裡同一個詞可以不再標）
export function parseRuby(str, where, ctx) {
  const segs = []
  let i = 0
  const chars = [...str]
  while (i < chars.length) {
    if (!RUN.test(chars[i])) {
      segs.push([chars[i++]])
      continue
    }
    let j = i
    while (j < chars.length && RUN.test(chars[j])) j++
    const run = chars.slice(i, j).join('')
    if (chars[j] === '(') {
      const end = chars.indexOf(')', j)
      if (end < 0) throw new Error(`${where}：「${run}(」少了右括號`)
      const rt = chars.slice(j + 1, end).join('')
      if (!/^[ぁ-ゖー]+$/.test(rt)) throw new Error(`${where}：「${run}(${rt})」讀音要用平假名`)
      ctx.set(run, ctx.has(run) && ctx.get(run) !== rt ? null : rt)
      segs.push(...rubySegs(run, rt, where))
      i = end + 1
      continue
    }
    const rt = run === '来' && KURU[chars[j]] ? KURU[chars[j]] : ctx.get(run)
    if (!rt) throw new Error(`${where}：「${run}」沒有標讀音（句子裡也沒有同一個詞可以沿用）`)
    segs.push(...rubySegs(run, rt, where))
    i = j
  }
  const out = mergeKana(segs)
  if (out.some((s) => !s[1] && KANJI.test(s[0]))) throw new Error(`${where}：有漢字沒標讀音「${str}」`)
  return out
}
export const textOf = (segs) => segs.map((s) => s[0]).join('')
export const kanaOf = (segs) => segs.map((s) => s[1] || s[0]).join('')

// 選項說明檔：一行 日文/說明，日文也可以標讀音（に反(はん)して）：選項沒標讀音時沿用
// 多個檔案時前面的檔案優先（同一個檔案裡寫兩次的，以後面的為準）
export function loadGloss(files, errors) {
  const gloss = new Map()
  const segsOf = new Map()
  for (const file of files) {
    const mine = new Map()
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, n) => {
        const t = line.trim()
        if (!t || t.startsWith('#')) return
        const i = t.indexOf('/')
        try {
          const segs = parseRuby(t.slice(0, i), `${file.split('/').slice(-2).join('/')}:${n + 1}`, new Map())
          mine.set(textOf(segs), [t.slice(i + 1), segs])
        } catch (e) {
          errors.push(e.message)
        }
      })
    for (const [key, [zh, segs]] of mine) {
      if (gloss.has(key)) continue
      gloss.set(key, zh)
      segsOf.set(key, segs)
    }
  }
  return { gloss, segsOf }
}

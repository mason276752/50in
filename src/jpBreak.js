// 日文換行：只在「文節」之間斷行（ちょっと｜手伝って｜ください），不要斷在 手｜伝 或剩一個「い」
// 用瀏覽器內建的 Intl.Segmenter 切詞，再把助詞、語尾黏回前面的詞

const SEG = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ja', { granularity: 'word' }) : null
const PUNCT = /[、。！？!?」』…]/
const KANJI = /[\u4e00-\u9fff々〆]/
const KATA = /^[\u30a1-\u30faー]+$/
// 助詞、助動詞、語尾：黏在前一個詞後面（短的平假名片段幾乎都是這類）
const FUNC = /^(から|まで|より|ので|のに|けど|けれど|ても|でも|たり|です|ます|ませ|まし|でし|ください|くださ|ござい|いたし|ない|なかっ|そう|よう|みたい|らしい|てい|てる|ちゃ|じゃ|ん)/
const isFunc = (t) => PUNCT.test(t) || (/^[ぁ-ゖー]+$/.test(t) && (t.length <= 2 || FUNC.test(t)))

// 回傳 ja 裡可以斷行的位置（字元 offset）：每一節 = 一個實詞 + 後面的助詞語尾
function jaBreaks(ja) {
  const out = new Set()
  if (!SEG) return out
  const segs = [...SEG.segment(ja)].map((s) => ({ text: s.segment, at: Array.from(ja.slice(0, s.index)).length }))
  let chunkLen = 0
  // 接頭的お／ご（お願い、ご確認）算進後面的實詞
  const isPrefix = (i) => /^[おご]$/.test(segs[i]?.text) && /^[\u4e00-\u9fff]/.test(segs[i + 1]?.text || '')
  // ございます前面也可以斷（おめでとう｜ございます），選項格子窄的時候才不會斷成 おめでとうご｜ざいます
  const chars = Array.from(ja)
  const gozai = (i) => chars.slice(segs[i].at, segs[i].at + 3).join('') === 'ござい'
  segs.forEach((s, i) => {
    const prev = segs[i - 1]
    let brk = false
    if (prev && PUNCT.test(prev.text.at(-1)) && !PUNCT.test(s.text)) brk = true // 、後面一定可以斷
    else if (prev && !isPrefix(i - 1) && (isPrefix(i) || !isFunc(s.text) || gozai(i))) {
      // 實詞前面可以斷；但連著兩個漢字詞（恐れ｜入り、準備｜中、手｜伝って）或片假名詞（マナー｜モード）是複合詞，不斷
      const compound =
        !isPrefix(i) && !isFunc(prev.text) && ((KANJI.test(prev.text) && KANJI.test(s.text[0])) || (KATA.test(prev.text) && KATA.test(s.text)))
      brk = !compound
    }
    if (brk && chunkLen >= 3) {
      out.add(s.at)
      chunkLen = 0
    }
    chunkLen += Array.from(s.text).length
  })
  return out
}

// 把文字切成可以斷行的片段：mode 'kana' 用讀音、其他用原文
// 讀音的斷點由原文的斷點對應過去（照振假名分段），漢字組（明日＝あした）中間不斷
export function jpChunks(word, mode) {
  const breaks = jaBreaks(word.ja)
  const segs = word.furi || [[word.ja]]
  const useKana = mode === 'kana'
  const chunks = ['']
  let jaAt = 0
  for (const [text, rt] of segs) {
    const len = Array.from(text).length
    if (rt) {
      if (breaks.has(jaAt) && chunks.at(-1)) chunks.push('')
      chunks[chunks.length - 1] += useKana ? rt : text
    } else {
      Array.from(text).forEach((c, i) => {
        if (breaks.has(jaAt + i) && chunks.at(-1)) chunks.push('')
        chunks[chunks.length - 1] += c
      })
    }
    jaAt += len
  }
  return chunks
}

// JpWord 漢字+假名模式用：每個振假名段前面要不要放斷點、假名段內部在哪裡斷
export function furiWithBreaks(word) {
  const breaks = jaBreaks(word.ja)
  let jaAt = 0
  return (word.furi || [[word.ja, word.kana]]).map(([text, rt]) => {
    const start = jaAt
    jaAt += Array.from(text).length
    if (rt) return { text, rt, breakBefore: breaks.has(start) && start > 0, group: text.length > 1 }
    const pieces = ['']
    Array.from(text).forEach((c, i) => {
      if (breaks.has(start + i) && pieces.at(-1)) pieces.push('')
      pieces[pieces.length - 1] += c
    })
    return { pieces, breakBefore: breaks.has(start) && start > 0 }
  })
}

// 字體大小：最多三行、每行要放得下最長的那一節；單字一行放完
export function fitSize(chunks, { max = 30, width = 88 } = {}) {
  const lens = chunks.map((c) => Array.from(c).length)
  const total = lens.reduce((a, b) => a + b, 0) || 1
  for (let per = Math.max(...lens, Math.ceil(total / 3)); ; per++) {
    let lines = 1
    let cur = 0
    for (const l of lens) {
      if (cur && cur + l > per) {
        lines++
        cur = 0
      }
      cur += l
    }
    if (lines <= 3 || per >= total) return Math.min(max, width / per)
  }
}

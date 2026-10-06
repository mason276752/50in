import { toHiragana } from './kana'

// Google Input Tools 的手寫辨識（Gboard / Google 翻譯用的同一個服務，需要網路）
const ENDPOINT = 'https://inputtools.google.com/request?ime=handwriting&app=translate&cs=1&oe=UTF-8'

// strokes: [[xs, ys, ts], …]；回傳候選字（最可能的在前）
export async function recognize(strokes, width, height, signal) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      options: 'enable_pre_space',
      requests: [
        {
          writing_guide: { writing_area_width: Math.round(width), writing_area_height: Math.round(height) },
          ink: strokes,
          language: 'ja',
        },
      ],
    }),
  })
  const data = await res.json()
  if (data[0] !== 'SUCCESS') throw new Error(String(data[0]))
  return data[1]?.[0]?.[1] ?? []
}

// 手寫很難分大小字（きゃ 常被認成 きや），比對時一律當大字
const SMALL = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ'
const LARGE = 'あいうえおつやゆよわアイウエオツヤユヨワ'
function normalize(s) {
  return Array.from(s.replace(/\s/g, ''), (c) => {
    const i = SMALL.indexOf(c)
    return i >= 0 ? LARGE[i] : c
  }).join('')
}

// 第一候選要是目標字；平/片長得一樣的字（へ/ヘ、べ/ベ…）只要目標也在候選裡就算對
export function matchWritten(candidates, item) {
  if (!candidates.length) return false
  const target = normalize(item.display)
  const top = normalize(candidates[0])
  if (top === target) return true
  return toHiragana(top) === toHiragana(target) && candidates.slice(0, 5).some((c) => normalize(c) === target)
}

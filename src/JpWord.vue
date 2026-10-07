<script setup>
import { computed } from 'vue'
import { toHiragana } from './kana'

// 依顯示方式呈現日文單字：'kana' 只給讀音 | 'kanji' 只給漢字 | 'both' 漢字上方標振假名
const props = defineProps({
  word: { type: Object, required: true },
  mode: { type: String, default: 'kana' },
})

const KANA = /[぀-ヿー]/
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 把詞切成漢字段、假名段，再用讀音對齊：恐れ入る ↔ おそれいる → 恐(おそ) れ 入(い) る
// 假名段（送り仮名、中間的れ、開頭的お）本身就是讀音，不標；對不上時整段標在漢字上
const segments = computed(() => {
  const { ja, kana } = props.word
  const parts = ja.match(/[぀-ヿー]+|[^぀-ヿー]+/g) || [ja]
  const pattern = parts.map((p) => (KANA.test(p[0]) ? escape(toHiragana(p)) : '(.+?)')).join('')
  const m = toHiragana(kana).match(new RegExp(`^${pattern}$`))
  if (!m) return [{ text: ja, rt: kana }]
  let g = 1
  return parts.map((p) => (KANA.test(p[0]) ? { text: p } : { text: p, rt: m[g++] }))
})
</script>

<template>
  <span class="jp" lang="ja">
    <template v-if="mode === 'both' && word.ja !== word.kana">
      <template v-for="(s, i) in segments" :key="i"
        ><ruby v-if="s.rt">{{ s.text }}<rt>{{ s.rt }}</rt></ruby
        ><template v-else>{{ s.text }}</template></template
      >
    </template>
    <template v-else>{{ mode === 'kana' ? word.kana : word.ja }}</template>
  </span>
</template>

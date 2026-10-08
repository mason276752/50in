<script setup>
import { computed } from 'vue'
import { jpChunks, furiWithBreaks } from './jpBreak'

// 依顯示方式呈現日文單字：'kana' 只給讀音 | 'kanji' 只給漢字 | 'both' 漢字上方標振假名
const props = defineProps({
  word: { type: Object, required: true },
  mode: { type: String, default: 'kana' },
  compact: Boolean, // 小字用：連續漢字合成一組標（携帯電話＝けいたいでんわ），不然讀音會把字撐開
})

// 題庫已經把讀音逐字切好（word.furi）：一(いち)部(ぶ)分(ぶん)、恐(おそ)れ入(い)る；
// 熟字訓（明日／あした）是整段一組，置中標在整個詞上
// 短句只在文節之間斷行（<wbr>），配合 word-break: keep-all，不會斷在 手｜伝 或剩一個字
const ruby = computed(() => props.mode === 'both' && props.word.ja !== props.word.kana)
const segments = computed(() => {
  const segs = furiWithBreaks(props.word)
  if (!props.compact) return segs
  const out = []
  for (const s of segs) {
    const last = out.at(-1)
    if (s.rt && last?.rt && !s.breakBefore) Object.assign(last, { text: last.text + s.text, rt: last.rt + s.rt, group: true })
    else out.push({ ...s })
  }
  return out
})
const chunks = computed(() => jpChunks(props.word, props.mode === 'kana' ? 'kana' : 'kanji'))
</script>

<template>
  <span class="jp" lang="ja">
    <template v-if="ruby">
      <template v-for="(s, i) in segments" :key="i"
        ><wbr v-if="s.breakBefore" /><ruby v-if="s.rt" :class="{ group: s.group }">{{ s.text }}<rt>{{ s.rt }}</rt></ruby
        ><template v-else><template v-for="(p, j) in s.pieces" :key="j"><wbr v-if="j" />{{ p }}</template></template></template
      >
    </template>
    <template v-else><template v-for="(c, i) in chunks" :key="i"><wbr v-if="i" />{{ c }}</template></template>
  </span>
</template>

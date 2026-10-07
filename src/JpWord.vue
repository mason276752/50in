<script setup>
import { computed } from 'vue'

// 依顯示方式呈現日文單字：'kana' 只給讀音 | 'kanji' 只給漢字 | 'both' 漢字上方標振假名
const props = defineProps({
  word: { type: Object, required: true },
  mode: { type: String, default: 'kana' },
})

// 題庫已經把讀音逐字切好（word.furi）：一(いち)部(ぶ)分(ぶん)、恐(おそ)れ入(い)る；
// 熟字訓（明日／あした）是整段一組，置中標在整個詞上
const segments = computed(() =>
  (props.word.furi || [[props.word.ja, props.word.kana]]).map(([text, rt]) => ({ text, rt, group: rt && text.length > 1 })),
)
</script>

<template>
  <span class="jp" lang="ja">
    <template v-if="mode === 'both' && word.ja !== word.kana">
      <template v-for="(s, i) in segments" :key="i"
        ><ruby v-if="s.rt" :class="{ group: s.group }">{{ s.text }}<rt>{{ s.rt }}</rt></ruby
        ><template v-else>{{ s.text }}</template></template
      >
    </template>
    <template v-else>{{ mode === 'kana' ? word.kana : word.ja }}</template>
  </span>
</template>

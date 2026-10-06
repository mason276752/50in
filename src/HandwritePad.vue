<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

// 手寫板：記錄筆畫（給辨識用），每寫完一筆 emit('stroke')，下筆時 emit('pen-down')
const props = defineProps({ guide: { type: String, default: '' } })
const emit = defineEmits(['stroke', 'pen-down'])
// 拗音兩個字要並排塞進框裡，字縮小
const guideSize = computed(() => (Array.from(props.guide).length > 1 ? 44 : 68))

const canvasEl = ref(null)
const strokes = [] // [[xs, ys, ts], …]
let current = null
let startTime = 0
let ctx = null
let ro = null

function size() {
  const c = canvasEl.value
  return { w: c.clientWidth, h: c.clientHeight }
}

function resize() {
  const c = canvasEl.value
  const dpr = window.devicePixelRatio || 1
  const { w, h } = size()
  c.width = Math.round(w * dpr)
  c.height = Math.round(h * dpr)
  ctx = c.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  redraw()
}

function redraw() {
  if (!ctx) return
  const { w, h } = size()
  ctx.clearRect(0, 0, w, h)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(6, w / 36)
  ctx.strokeStyle = getComputedStyle(canvasEl.value).color
  for (const [xs, ys] of strokes) {
    ctx.beginPath()
    ctx.moveTo(xs[0], ys[0])
    for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i], ys[i])
    if (xs.length === 1) ctx.lineTo(xs[0] + 0.1, ys[0])
    ctx.stroke()
  }
}

function point(e) {
  const r = canvasEl.value.getBoundingClientRect()
  return [e.clientX - r.left, e.clientY - r.top]
}

function onDown(e) {
  if (current) return
  e.preventDefault()
  canvasEl.value.setPointerCapture(e.pointerId)
  if (!strokes.length) startTime = performance.now()
  const [x, y] = point(e)
  current = { id: e.pointerId, stroke: [[x], [y], [Math.round(performance.now() - startTime)]] }
  strokes.push(current.stroke)
  emit('pen-down')
  redraw()
}

function onMove(e) {
  if (!current || e.pointerId !== current.id) return
  const [xs, ys, ts] = current.stroke
  const events = e.getCoalescedEvents?.() ?? [e]
  for (const ev of events.length ? events : [e]) {
    const [x, y] = point(ev)
    xs.push(x)
    ys.push(y)
    ts.push(Math.round(performance.now() - startTime))
  }
  redraw()
}

function onUp(e) {
  if (!current || e.pointerId !== current.id) return
  current = null
  emit('stroke')
}

function clear() {
  strokes.length = 0
  current = null
  redraw()
}

function undo() {
  if (current) return
  strokes.pop()
  redraw()
  if (strokes.length) emit('stroke')
}

defineExpose({
  clear,
  undo,
  isEmpty: () => !strokes.length,
  getInk: () => ({ strokes: strokes.map((s) => s.map((a) => [...a])), ...size() }),
})

onMounted(() => {
  resize()
  ro = new ResizeObserver(resize)
  ro.observe(canvasEl.value)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', redraw)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.matchMedia('(prefers-color-scheme: dark)').removeEventListener?.('change', redraw)
})
</script>

<template>
  <div class="pad">
    <div v-if="props.guide" class="pad-guide" :style="{ fontSize: `${guideSize}cqw` }" lang="ja">{{ props.guide }}</div>
    <div class="pad-cross" />
    <canvas
      ref="canvasEl"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @contextmenu.prevent
    />
  </div>
</template>

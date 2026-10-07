// 答對 / 答錯音效（檔案放在 public/）
const base = import.meta.env.BASE_URL
const sounds = {}

function get(name) {
  if (!sounds[name]) {
    const a = new Audio(`${base}${name}.mp3`)
    a.preload = 'auto'
    sounds[name] = a
  }
  return sounds[name]
}

// 先建立物件讓瀏覽器預載，第一次答題才不會延遲
export function preloadSfx() {
  get('dindong')
  get('error')
}

export function playSfx(kind) {
  const a = get(kind === 'ok' ? 'dindong' : 'error')
  a.currentTime = 0
  // 手機在使用者還沒點過畫面前會擋自動播放，失敗就算了
  a.play().catch(() => {})
}

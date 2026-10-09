// 會話題庫：一段一來一往的對話 + 3～4 題（克漏字、接話、閱讀理解）
// 資料在 data/dialogs.json，由 scripts/build-dialogs.mjs 從 scripts/dialogs/*.txt 產生（含振假名、每句的字典）
// 每段是範本，每次出題才帶入人名、時間、數量…並抽題（dialogInstance.js）
// 切到會話模式才載入
import { PHRASE_CATS, PHRASE_LEVELS } from './words'
import { instantiate } from './dialogInstance'

export const DIALOG_LEVELS = PHRASE_LEVELS
let ALL = null
let DATA = null
const BY_ID = new Map()
let loading = null

export function loadDialogs() {
  loading ||= import('./data/dialogs.json').then((m) => {
    DATA = m.default
    ALL = DATA.dialogs.map((d) => ({
      ...d,
      num: d.id,
      id: `dlg:${d.id}`,
      kind: 'dialog',
      deck: 'dialog',
      group: d.cat,
      display: d.title, // 對照表、弱點列表顯示標題
      caption: DIALOG_LEVELS[d.level - 1].label,
    }))
    for (const d of ALL) BY_ID.set(d.id, d)
  })
  return loading
}

// 這一次要出的對話（每次呼叫都重新帶入、重新抽題）
export function makeDialog(item) {
  return instantiate(item, DATA)
}

export function dialogById(id) {
  return BY_ID.get(id)
}

// 只列出有對話的情境
export function dialogCats() {
  const used = new Set((ALL || []).map((d) => d.cat))
  return PHRASE_CATS.filter((c) => used.has(c.key))
}

// 由簡入難：依難度分批，同難度內各情境輪流出
export function buildDialogPool(cats, levels) {
  if (!ALL) return []
  const out = []
  for (const { key: level } of DIALOG_LEVELS) {
    if (!levels.includes(level)) continue
    const lists = PHRASE_CATS.filter((c) => cats.includes(c.key)).map((c) => ALL.filter((d) => d.cat === c.key && d.level === level))
    for (let i = 0; lists.some((l) => i < l.length); i++) {
      for (const l of lists) if (l[i]) out.push(l[i])
    }
  }
  return out
}

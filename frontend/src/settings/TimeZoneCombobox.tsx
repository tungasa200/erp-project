// 시간대 콤보박스 (SCR-SET-02 ①). 입력해 거르고 ↑↓·Enter로 고른다. Esc나 칸을 벗어나면 고른 값으로 되돌린다.
// 맨 위 "추천" 묶음은 브라우저가 감지한 시간대와 Asia/Seoul(같으면 하나).
import { useId, useMemo, useState } from 'react'
import styles from './settings.module.css'
import { canonicalZone, detectedZone, matchZone, zoneOptions, type ZoneOption } from './timeZones'

interface Props {
  value: string
  onChange: (zone: string) => void
  labelledBy: string
  describedBy?: string
}

export function TimeZoneCombobox({ value, onChange, labelledBy, describedBy }: Props) {
  const id = useId()
  const options = useMemo(() => zoneOptions(), [])
  const current = canonicalZone(value)
  const labelOf = (zone: string) => options.find((o) => o.zone === zone)?.label ?? zone

  const [query, setQuery] = useState<string | null>(null) // null: 고른 값을 보여 주는 중
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const recommended = useMemo(() => {
    const zones = [detectedZone(), 'Asia/Seoul'].filter((z, i, all): z is string => !!z && all.indexOf(z) === i)
    return zones.map((z) => options.find((o) => o.zone === z)).filter((o): o is ZoneOption => o !== undefined)
  }, [options])

  const filtered = useMemo(() => options.filter((o) => matchZone(o, query ?? '')), [options, query])
  // 검색 중이 아니면 추천 묶음을 위에 보여 준다. 키보드 이동은 두 묶음을 이어서 센다.
  const groups = query
    ? [{ name: '검색 결과', items: filtered }]
    : [
        { name: '추천', items: recommended },
        { name: '전체', items: options },
      ]
  const flat = groups.flatMap((g) => g.items)
  const optionId = (index: number) => `${id}-option-${index}`

  const close = () => {
    setOpen(false)
    setQuery(null)
  }

  const pick = (zone: string) => {
    close()
    if (zone !== current) onChange(zone)
  }

  return (
    <div className={styles.combo}>
      <input
        id={`${id}-input`}
        role="combobox"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && flat.length > 0 ? optionId(active) : undefined}
        className={styles.comboInput}
        autoComplete="off"
        value={query ?? labelOf(current)}
        onFocus={(e) => e.currentTarget.select()}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onBlur={close}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) return setOpen(true)
            const step = e.key === 'ArrowDown' ? 1 : -1
            setActive((i) => (flat.length === 0 ? 0 : (i + step + flat.length) % flat.length))
          } else if (e.key === 'Enter' && open && flat[active]) {
            e.preventDefault()
            pick(flat[active].zone)
          } else if (e.key === 'Escape' && open) {
            e.preventDefault()
            close()
          }
        }}
      />
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-labelledby={labelledBy} className={styles.comboList}>
          {flat.length === 0 && <li className={styles.comboEmpty}>찾는 시간대가 없어요</li>}
          {groups.map((g, gi) => {
            const start = groups.slice(0, gi).reduce((n, x) => n + x.items.length, 0)
            return g.items.length === 0 ? null : (
              <li key={g.name} role="presentation">
                <div className={styles.comboGroup} aria-hidden="true">
                  {g.name}
                </div>
                <ul role="group" aria-label={g.name} className={styles.comboGroupList}>
                  {g.items.map((o, i) => (
                    <li
                      key={`${g.name}-${o.zone}`}
                      id={optionId(start + i)}
                      role="option"
                      aria-selected={o.zone === current}
                      className={
                        start + i === active ? `${styles.comboOption} ${styles.comboActive}` : styles.comboOption
                      }
                      // 칸의 blur보다 먼저 고르도록 mousedown에서 처리한다
                      onMouseDown={(e) => {
                        e.preventDefault()
                        pick(o.zone)
                      }}
                    >
                      {o.label}
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Occurrence } from './api'
import { TimeGrid } from './TimeGrid'

// jsdom에는 PointerEvent·포인터 캡처가 없다
window.PointerEvent ??= class extends MouseEvent {
  pointerId = 1
} as unknown as typeof PointerEvent
Element.prototype.setPointerCapture ??= function () {}

const DAY = '2026-10-07'
// 칸 하나 100×1152px(시간당 48px, 분당 0.8px)
const PX_PER_MINUTE = 0.8

describe('시간 그리드 블록 사이 틈 (D-76)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 1152,
    } as DOMRect)
  })
  afterEach(() => vi.restoreAllMocks())

  const renderGrid = () => {
    const onCreate = vi.fn()
    render(
      <TimeGrid
        days={[DAY]}
        occurrences={[
          {
            scheduleId: 'a',
            title: '짧은 일정',
            allDay: false,
            startAt: `${DAY}T09:00:00Z`,
            endAt: `${DAY}T09:15:00Z`,
          } as Occurrence,
        ]}
        timeZone="UTC"
        today={DAY}
        now={Date.parse(`${DAY}T00:00:00Z`)}
        colorOf={() => null}
        pending={null}
        onCreate={onCreate}
        onCreateAllDay={vi.fn()}
        onOpen={vi.fn()}
        onMove={vi.fn()}
      />,
    )
    // 블록 밖을 누르면 대상은 날짜 칸
    const column = screen.getByRole('button', { name: /짧은 일정/ }).parentElement!
    const press = (minutes: number) => {
      const clientY = minutes * PX_PER_MINUTE
      fireEvent.pointerDown(column, { button: 0, clientX: 50, clientY })
      fireEvent.pointerUp(column, { button: 0, clientX: 50, clientY })
    }
    return { onCreate, press }
  }

  it('15분 블록이 그려진 30분 범위의 위아래 1px 틈을 눌러도 새 일정을 만들지 않는다', () => {
    const { onCreate, press } = renderGrid()
    // 블록은 9:00~9:30 범위의 위아래 1px 안쪽에 그려진다
    press(9 * 60 + 0.5 / PX_PER_MINUTE)
    press(9 * 60 + 30 - 0.5 / PX_PER_MINUTE)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('블록 밖 빈 칸을 누르면 새 일정을 만든다', () => {
    const { onCreate, press } = renderGrid()
    press(10 * 60)
    expect(onCreate).toHaveBeenCalledWith({ date: DAY, start: 600, end: 660 })
  })
})

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

describe('모바일 주 보기 훑어보기 (D-77)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 300,
      height: 1152,
    } as DOMRect)
  })
  afterEach(() => vi.restoreAllMocks())

  it('하루 칸 전체가 일 보기 버튼이고, 블록 누름·빈 칸 만들기·끌기는 꺼진다', () => {
    const onCreate = vi.fn()
    const onOpen = vi.fn()
    const onMove = vi.fn()
    const onOpenDay = vi.fn()
    // 2026-10-06(화)~10-08(목) 3일, 6일에 시간 일정 2개 + 6~7일 종일 일정 1개
    render(
      <TimeGrid
        days={['2026-10-06', '2026-10-07', '2026-10-08']}
        occurrences={
          [
            {
              scheduleId: 'a',
              title: '회의',
              allDay: false,
              startAt: '2026-10-06T09:00:00Z',
              endAt: '2026-10-06T10:00:00Z',
            },
            {
              scheduleId: 'b',
              title: '점심',
              allDay: false,
              startAt: '2026-10-06T12:00:00Z',
              endAt: '2026-10-06T13:00:00Z',
            },
            { scheduleId: 'c', title: '출장', allDay: true, startDate: '2026-10-06', endDate: '2026-10-07' },
          ] as Occurrence[]
        }
        timeZone="UTC"
        today="2026-10-07"
        now={Date.parse('2026-10-07T00:00:00Z')}
        colorOf={() => null}
        pending={null}
        onCreate={onCreate}
        onCreateAllDay={vi.fn()}
        onOpen={onOpen}
        onMove={onMove}
        onOpenDay={onOpenDay}
        overview
      />,
    )

    expect(screen.queryByRole('button', { name: /회의/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /출장/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '10월 7일 수요일, 일정 1개' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '10월 8일 목요일, 일정 0개' })).toBeInTheDocument()

    const day = screen.getByRole('button', { name: '10월 6일 화요일, 일정 3개' })
    // 블록 위·빈 칸에서 누르고 끌어도 만들기·이동은 일어나지 않는다
    fireEvent.pointerDown(day, { button: 0, clientX: 50, clientY: 9 * 60 * PX_PER_MINUTE + 10 })
    fireEvent.pointerMove(day, { button: 0, clientX: 50, clientY: 15 * 60 * PX_PER_MINUTE })
    fireEvent.pointerUp(day, { button: 0, clientX: 50, clientY: 15 * 60 * PX_PER_MINUTE })
    expect(onCreate).not.toHaveBeenCalled()
    expect(onMove).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()

    fireEvent.click(day)
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-06')
  })
})

describe('오프라인 (P1-X-04)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 1152,
    } as DOMRect)
  })
  afterEach(() => vi.restoreAllMocks())

  it('editable=false면 빈 칸 만들기·블록 끌기가 일어나지 않는다', () => {
    const onCreate = vi.fn()
    const onMove = vi.fn()
    render(
      <TimeGrid
        days={[DAY]}
        occurrences={[
          {
            scheduleId: 'a',
            title: '회의',
            allDay: false,
            startAt: `${DAY}T09:00:00Z`,
            endAt: `${DAY}T10:00:00Z`,
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
        onMove={onMove}
        editable={false}
      />,
    )
    const block = screen.getByRole('button', { name: /회의/ })
    const column = block.parentElement!
    fireEvent.pointerDown(column, { button: 0, clientX: 50, clientY: 14 * 60 * PX_PER_MINUTE })
    fireEvent.pointerUp(column, { button: 0, clientX: 50, clientY: 14 * 60 * PX_PER_MINUTE })
    fireEvent.pointerDown(block, { button: 0, clientX: 50, clientY: 9 * 60 * PX_PER_MINUTE + 10 })
    fireEvent.pointerMove(block, { button: 0, clientX: 50, clientY: 12 * 60 * PX_PER_MINUTE })
    fireEvent.pointerUp(block, { button: 0, clientX: 50, clientY: 12 * 60 * PX_PER_MINUTE })
    expect(onCreate).not.toHaveBeenCalled()
    expect(onMove).not.toHaveBeenCalled()
  })
})

describe('블록을 마우스로 열면 포커스 (CAL-07 기록 창 복귀)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 1152,
    } as DOMRect)
  })
  afterEach(() => vi.restoreAllMocks())

  it('끌기 처리가 기본 동작을 막아도 누른 블록이 포커스를 받아, 연 창을 닫으면 그 블록으로 돌아온다', () => {
    const onOpen = vi.fn()
    render(
      <TimeGrid
        days={[DAY]}
        occurrences={[
          {
            scheduleId: 'a',
            title: '회의',
            allDay: false,
            startAt: `${DAY}T09:00:00Z`,
            endAt: `${DAY}T10:00:00Z`,
          } as Occurrence,
        ]}
        timeZone="UTC"
        today={DAY}
        now={Date.parse(`${DAY}T00:00:00Z`)}
        colorOf={() => null}
        pending={null}
        onCreate={vi.fn()}
        onCreateAllDay={vi.fn()}
        onOpen={onOpen}
        onMove={vi.fn()}
      />,
    )
    const block = screen.getByRole('button', { name: /회의/ })
    const clientY = 9 * 60 * PX_PER_MINUTE + 10
    fireEvent.pointerDown(block, { button: 0, clientX: 50, clientY })
    fireEvent.pointerUp(block, { button: 0, clientX: 50, clientY })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(block).toHaveFocus()
  })
})

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Occurrence } from './api'
import { TimeGrid } from './TimeGrid'

// jsdom에는 PointerEvent·포인터 캡처가 없다. 터치 규칙 시험을 위해 pointerType을 받는다
window.PointerEvent ??= class extends MouseEvent {
  pointerId: number
  pointerType: string
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? 'mouse'
  }
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

describe('오프라인 마우스 click (SCR-SYS-02 ③ 열어 보기)', () => {
  const renderGrid = (editable: boolean) => {
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
          {
            scheduleId: 'b',
            occurrenceStart: `${DAY}T00:00:00Z`,
            title: '워크숍',
            allDay: true,
            startDate: DAY,
            endDate: DAY,
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
        editable={editable}
      />,
    )
    return onOpen
  }

  it('오프라인이면 끌기 처리가 꺼져도 블록·종일 막대를 마우스로 누르면 연다', () => {
    const onOpen = renderGrid(false)
    fireEvent.click(screen.getByRole('button', { name: /회의/ }), { detail: 1 })
    fireEvent.click(screen.getByRole('button', { name: /워크숍/ }), { detail: 1 })
    expect(onOpen.mock.calls.map(([o]) => o.title)).toEqual(['회의', '워크숍'])
  })

  it('온라인이면 마우스 click은 pointer 처리가 열므로 click에서 다시 열지 않는다', () => {
    const onOpen = renderGrid(true)
    fireEvent.click(screen.getByRole('button', { name: /회의/ }), { detail: 1 })
    fireEvent.click(screen.getByRole('button', { name: /워크숍/ }), { detail: 1 })
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('손가락 터치 규칙 (SCR-CAL 공통: 바로 밀면 스크롤, 짧게 누르면 누르기, 길게 누른 뒤 끌기)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 1152,
    } as DOMRect)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const renderGrid = () => {
    const onCreate = vi.fn()
    const onOpen = vi.fn()
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
        onOpen={onOpen}
        onMove={onMove}
      />,
    )
    const block = screen.getByRole('button', { name: /회의/ })
    const column = block.parentElement!
    const at = (minutes: number) => ({ clientX: 50, clientY: minutes * PX_PER_MINUTE })
    const touch = { button: 0, pointerType: 'touch', pointerId: 7 }
    return { onCreate, onOpen, onMove, block, column, at, touch }
  }
  const hold = () => act(() => void vi.advanceTimersByTime(450))
  /** 브라우저가 스크롤에 쓰는 touchmove를 막았는지 */
  const scrollBlocked = (el: Element) => {
    const e = new Event('touchmove', { bubbles: true, cancelable: true })
    el.dispatchEvent(e)
    return e.defaultPrevented
  }

  it('빈 칸에서 바로 밀면(스크롤) 범위를 만들지 않고 스크롤을 막지 않는다', () => {
    const { onCreate, column, at, touch } = renderGrid()
    fireEvent.pointerDown(column, { ...touch, ...at(720) })
    fireEvent.pointerMove(column, { ...touch, ...at(780) })
    expect(scrollBlocked(column)).toBe(false)
    fireEvent.pointerUp(column, { ...touch, ...at(780) })
    hold()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('빈 칸을 짧게 누르면 그 칸에서 1시간 일정을 만든다(클릭과 같음)', () => {
    const { onCreate, column, at, touch } = renderGrid()
    fireEvent.pointerDown(column, { ...touch, ...at(720) })
    fireEvent.pointerMove(column, { ...touch, ...at(723) })
    fireEvent.pointerUp(column, { ...touch, ...at(723) })
    expect(onCreate).toHaveBeenCalledWith({ date: DAY, start: 720, end: 780 })
  })

  it('길게 누른 뒤 끌면 범위를 만들고, 그동안 스크롤을 막는다', () => {
    const { onCreate, column, at, touch } = renderGrid()
    fireEvent.pointerDown(column, { ...touch, ...at(720) })
    hold()
    expect(scrollBlocked(column)).toBe(true)
    fireEvent.pointerMove(column, { ...touch, ...at(780) })
    fireEvent.pointerUp(column, { ...touch, ...at(780) })
    expect(onCreate).toHaveBeenCalledWith({ date: DAY, start: 720, end: 795 })
    // 뗀 뒤에는 다시 스크롤된다
    expect(scrollBlocked(column)).toBe(false)
  })

  it('블록 위에서 바로 밀면 옮기지도 열지도 않고, 짧게 누르면 연다', () => {
    const { onOpen, onMove, block, at, touch } = renderGrid()
    fireEvent.pointerDown(block, { ...touch, ...at(560) })
    fireEvent.pointerMove(block, { ...touch, ...at(620) })
    fireEvent.pointerUp(block, { ...touch, ...at(620) })
    hold()
    expect(onMove).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()

    fireEvent.pointerDown(block, { ...touch, ...at(560) })
    fireEvent.pointerUp(block, { ...touch, ...at(560) })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(block).toHaveFocus()
  })

  it('블록을 길게 누르면 잡힘 표시가 뜨고, 끌면 옮긴다', () => {
    const { onMove, block, at, touch } = renderGrid()
    fireEvent.pointerDown(block, { ...touch, ...at(560) })
    expect(block).not.toHaveAttribute('data-held')
    hold()
    expect(block).toHaveAttribute('data-held')
    fireEvent.pointerMove(block, { ...touch, ...at(620) })
    fireEvent.pointerUp(block, { ...touch, ...at(620) })
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ title: '회의' }), {
      startAt: '2026-10-07T10:00:00.000Z',
      endAt: '2026-10-07T11:00:00.000Z',
    })
  })

  it('마우스는 지금처럼 기다리지 않고 바로 끈다', () => {
    const { onCreate, column, at } = renderGrid()
    fireEvent.pointerDown(column, { button: 0, ...at(720) })
    fireEvent.pointerMove(column, { button: 0, ...at(780) })
    fireEvent.pointerUp(column, { button: 0, ...at(780) })
    expect(onCreate).toHaveBeenCalledWith({ date: DAY, start: 720, end: 795 })
  })
})

describe('처음 스크롤 위치 (UX-CAL-73·74)', () => {
  const renderAt = (nowIso: string, nowSignal?: number) => (
    <TimeGrid
      days={[DAY]}
      occurrences={[]}
      timeZone="UTC"
      today={DAY}
      now={Date.parse(nowIso)}
      colorOf={() => null}
      pending={null}
      onCreate={vi.fn()}
      onCreateAllDay={vi.fn()}
      onOpen={vi.fn()}
      onMove={vi.fn()}
      nowSignal={nowSignal}
    />
  )
  const scroller = () => document.querySelector<HTMLElement>('[class*="gridScroll"]')!

  it('08시부터 보이되 첫 라벨이 잘리지 않게 조금 위에서 시작한다', () => {
    render(renderAt(`${DAY}T10:00:00Z`))
    expect(scroller().scrollTop).toBe(8 * 48 - 12)
  })

  it('이른 아침에 열면 지금 한 시간 전부터 보인다', () => {
    render(renderAt(`${DAY}T03:00:00Z`))
    expect(scroller().scrollTop).toBe(2 * 48)
  })

  it('[오늘]을 누르면(nowSignal) 지금이 화면 밖일 때만 지금으로 스크롤한다', () => {
    const { rerender } = render(renderAt(`${DAY}T10:00:00Z`, 0))
    scroller().scrollTop = 0
    rerender(renderAt(`${DAY}T10:00:00Z`, 1))
    expect(scroller().scrollTop).toBe(0)
    rerender(renderAt(`${DAY}T21:00:00Z`, 2))
    expect(scroller().scrollTop).toBe(20 * 48)
  })
})

describe('끌기 중 가장자리 자동 스크롤 (UX-CAL-94)', () => {
  let frames: FrameRequestCallback[] = []
  beforeEach(() => {
    frames = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    // 스크롤 영역은 화면 위 0~400px, 날짜 칸은 스크롤만큼 위로 밀린다
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const scroller = document.querySelector<HTMLElement>('[class*="gridScroll"]')!
      if (this === scroller) return { left: 0, top: 0, width: 100, height: 400, bottom: 400 } as DOMRect
      return { left: 0, top: -scroller.scrollTop, width: 100, height: 1152, bottom: 1152 } as DOMRect
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('아래 가장자리에 머무르면 스크롤하며 블록도 함께 늦은 시각으로 옮긴다', () => {
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
        now={Date.parse(`${DAY}T10:00:00Z`)}
        colorOf={() => null}
        pending={null}
        onCreate={vi.fn()}
        onCreateAllDay={vi.fn()}
        onOpen={vi.fn()}
        onMove={onMove}
      />,
    )
    const scroller = document.querySelector<HTMLElement>('[class*="gridScroll"]')!
    const block = screen.getByRole('button', { name: /회의/ })
    const start = 9 * 60 * PX_PER_MINUTE - scroller.scrollTop + 10
    fireEvent.pointerDown(block, { button: 0, clientX: 50, clientY: start })
    // 아래 가장자리 40px 안(390px): 한 프레임에 약 10.5px
    fireEvent.pointerMove(block, { button: 0, clientX: 50, clientY: 390 })
    const before = scroller.scrollTop
    act(() => {
      for (let i = 0; i < 20; i++) frames.shift()?.(0)
    })
    expect(scroller.scrollTop).toBeGreaterThan(before + 150)
    fireEvent.pointerUp(block, { button: 0, clientX: 50, clientY: 390 })
    const moved = onMove.mock.calls[0][1].startAt as string
    // 손가락 자리(390px)는 그대로지만 스크롤만큼 늦은 시각이 된다
    const minutes = (390 + scroller.scrollTop) / PX_PER_MINUTE - (start + before) / PX_PER_MINUTE + 9 * 60
    expect(Date.parse(moved)).toBe(Date.parse(`${DAY}T00:00:00Z`) + Math.round(minutes / 15) * 15 * 60_000)
  })

  it('가운데에서는 스크롤하지 않는다', () => {
    render(
      <TimeGrid
        days={[DAY]}
        occurrences={[]}
        timeZone="UTC"
        today={DAY}
        now={Date.parse(`${DAY}T10:00:00Z`)}
        colorOf={() => null}
        pending={null}
        onCreate={vi.fn()}
        onCreateAllDay={vi.fn()}
        onOpen={vi.fn()}
        onMove={vi.fn()}
      />,
    )
    const scroller = document.querySelector<HTMLElement>('[class*="gridScroll"]')!
    const column = document.querySelector<HTMLElement>('[class*="columns"]')!
    fireEvent.pointerDown(column, { button: 0, clientX: 50, clientY: 100 })
    fireEvent.pointerMove(column, { button: 0, clientX: 50, clientY: 200 })
    const before = scroller.scrollTop
    act(() => {
      for (let i = 0; i < 5; i++) frames.shift()?.(0)
    })
    expect(scroller.scrollTop).toBe(before)
  })
})

describe('겹침 상한 "+n" (CAL-70, X-07 A)', () => {
  beforeEach(() => {
    // 날짜 칸 폭 112px → 상한 floor(112/28) = 4열
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(112)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        cb: () => void
        constructor(cb: () => void) {
          this.cb = cb
        }
        observe() {
          this.cb()
        }
        disconnect() {}
      },
    )
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const at = (id: string, start: string, end: string) =>
    ({
      scheduleId: id,
      occurrenceStart: `${DAY}T${start}:00Z`,
      title: id,
      allDay: false,
      startAt: `${DAY}T${start}:00Z`,
      endAt: `${DAY}T${end}:00Z`,
    }) as Occurrence

  it('넘친 일정은 Tab으로 닿는 "+n"으로 묶고, 팝오버는 첫 항목 포커스·↑↓·Enter로 상세·Esc로 "+n"에 돌아간다', () => {
    const onOpen = vi.fn()
    render(
      <TimeGrid
        days={[DAY]}
        occurrences={[
          at('회의', '14:00', '15:00'),
          at('검토', '14:00', '15:30'),
          at('통화', '14:15', '15:15'),
          at('리뷰', '14:30', '15:00'),
          at('면접', '14:30', '15:30'),
          at('문서', '14:45', '15:15'),
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
    expect(screen.getAllByRole('button', { name: /^계획 · / })).toHaveLength(3)
    const more = screen.getByRole('button', { name: '14시대 일정 3개 더' })
    expect(more).toHaveTextContent('+3')

    act(() => more.click())
    const popover = screen.getByRole('dialog', { name: '14시대 일정 3개 더' })
    const items = within(popover).getAllByRole('button')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveFocus()
    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(items[1]).toHaveFocus()
    fireEvent.keyDown(items[1], { key: 'ArrowUp' })
    fireEvent.keyDown(items[0], { key: 'ArrowUp' })
    expect(items[2]).toHaveFocus()

    fireEvent.keyDown(items[2], { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(more).toHaveFocus()

    act(() => more.click())
    act(() => within(screen.getByRole('dialog')).getAllByRole('button')[0].click())
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

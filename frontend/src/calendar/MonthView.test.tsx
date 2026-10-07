import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Occurrence } from './api'
import { MonthView } from './MonthView'
import { addDays, monthGridStart } from './time'

const days = Array.from({ length: 42 }, (_, i) => addDays(monthGridStart('2026-10-01', 'MONDAY'), i))
// 10-06(화)에 종일 일정 4개
const occurrences = ['기획 회의', '디자인 검토', '배포 준비', '회고'].map(
  (title, i) =>
    ({
      scheduleId: `s${i}`,
      occurrenceStart: '2026-10-06T00:00:00Z',
      title,
      allDay: true,
      startDate: '2026-10-06',
      endDate: '2026-10-06',
      recurring: false,
    }) as Occurrence,
)

// jsdom에는 PointerEvent·포인터 캡처가 없다
window.PointerEvent ??= class extends MouseEvent {
  pointerId = 1
} as unknown as typeof PointerEvent
Element.prototype.setPointerCapture ??= function () {}

const renderMonth = (overview: boolean, editable = true) => {
  const onOpenDay = vi.fn()
  const onCreateAllDay = vi.fn()
  const onOpen = vi.fn()
  render(
    <MonthView
      days={days}
      month="2026-10"
      occurrences={occurrences}
      timeZone="Asia/Seoul"
      today="2026-10-07"
      colorOf={() => null}
      onOpen={onOpen}
      onOpenDay={onOpenDay}
      onCreateAllDay={onCreateAllDay}
      onMoveDays={vi.fn()}
      overview={overview}
      editable={editable}
    />,
  )
  return { onOpenDay, onCreateAllDay, onOpen }
}

describe('월 보기 (P1-07-11)', () => {
  it('좁은 칸에서 말줄임할 수 있게 칩 제목을 따로 감싸고, 칩 2개 + 더보기를 둔다', () => {
    renderMonth(false)
    const chip = screen.getByRole('button', { name: '기획 회의' })
    expect(chip.querySelector('span')).toHaveTextContent('기획 회의')
    expect(screen.getByRole('button', { name: '디자인 검토' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '배포 준비' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+2개 더보기' })).toBeInTheDocument()
  })

  it('칩을 마우스로 열면 끌기 처리가 기본 동작을 막아도 칩이 포커스를 받는다(창을 닫으면 그 칩으로 돌아옴)', () => {
    renderMonth(false)
    const chip = screen.getByRole('button', { name: '기획 회의' })
    fireEvent.pointerDown(chip, { button: 0 })
    fireEvent.pointerUp(chip, { button: 0 })
    expect(chip).toHaveFocus()
  })

  it('오프라인이면 끌기 처리가 꺼져도 칩을 마우스로 누르면 연다(SCR-SYS-02 ③), 온라인 click은 pointer 처리가 연다', () => {
    const { onOpen } = renderMonth(false, false)
    fireEvent.click(screen.getByRole('button', { name: '기획 회의' }), { detail: 1 })
    expect(onOpen).toHaveBeenCalledWith(occurrences[0])
    cleanup()
    const online = renderMonth(false)
    fireEvent.click(screen.getByRole('button', { name: '기획 회의' }), { detail: 1 })
    expect(online.onOpen).not.toHaveBeenCalled()
  })

  it('시각 일정 칩: 좁은 칸에서 숨길 수 있게 시각을 따로 감싸고, 접근 이름에는 시각을 둔다 (SCR-CAL-03 v1.7)', () => {
    render(
      <MonthView
        days={days}
        month="2026-10"
        occurrences={[
          {
            scheduleId: 't',
            occurrenceStart: '2026-10-07T00:30:00Z',
            title: '팀 스탠드업',
            allDay: false,
            startAt: '2026-10-07T00:30:00Z',
            endAt: '2026-10-07T01:00:00Z',
            recurring: true,
          } as Occurrence,
        ]}
        timeZone="Asia/Seoul"
        today="2026-10-07"
        colorOf={() => null}
        onOpen={vi.fn()}
        onOpenDay={vi.fn()}
        onCreateAllDay={vi.fn()}
        onMoveDays={vi.fn()}
      />,
    )
    const chip = screen.getByRole('button', { name: '09:30 팀 스탠드업, 반복' })
    expect(chip.querySelector('.chipTime')).toHaveTextContent('09:30')
    expect(chip).toHaveTextContent('09:30 팀 스탠드업')
  })

  it('모바일 훑어보기: 날짜 칸 전체가 일 보기 버튼이고, 칩·더보기·빈 칸 만들기는 없다', () => {
    const { onOpenDay, onCreateAllDay } = renderMonth(true)
    expect(screen.queryByRole('button', { name: '기획 회의' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /더보기/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '10월 9일 금요일 한글날, 일정 0개' })).toBeInTheDocument()

    const cell = screen.getByRole('button', { name: '10월 6일 화요일, 일정 4개' })
    // 점은 3개까지, 나머지는 +n
    expect(cell).toHaveTextContent('+1')
    fireEvent.click(cell)
    expect(onOpenDay).toHaveBeenCalledWith('2026-10-06')
    expect(onCreateAllDay).not.toHaveBeenCalled()
  })
})

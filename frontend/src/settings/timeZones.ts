// 시간대 목록 (SCR-SET-02 ①, erp-design 기준). 저장 값은 IANA 이름이고, 보여 줄 때만 "Asia/Seoul (UTC+09:00)"로 쓴다.
// Intl.supportedValuesOf('timeZone')은 ICU 때문에 옛 이름(Asia/Calcutta 등)을 주므로 tzdb backward 별칭을 정식 이름으로 바꾼다.

// tzdb backward 파일 중 지역/도시 형식으로 남는 별칭 → 정식 이름
const BACKWARD: Record<string, string> = {
  'Africa/Asmera': 'Africa/Asmara',
  'Africa/Timbuktu': 'Africa/Bamako',
  'America/Argentina/ComodRivadavia': 'America/Argentina/Catamarca',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Coral_Harbour': 'America/Panama',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Ensenada': 'America/Tijuana',
  'America/Fort_Wayne': 'America/Indiana/Indianapolis',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Knox_IN': 'America/Indiana/Knox',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'America/Porto_Acre': 'America/Rio_Branco',
  'America/Rosario': 'America/Argentina/Cordoba',
  'America/Santa_Isabel': 'America/Tijuana',
  'America/Shiprock': 'America/Denver',
  'Antarctica/South_Pole': 'Pacific/Auckland',
  'Asia/Ashkhabad': 'Asia/Ashgabat',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Chongqing': 'Asia/Shanghai',
  'Asia/Chungking': 'Asia/Shanghai',
  'Asia/Dacca': 'Asia/Dhaka',
  'Asia/Harbin': 'Asia/Shanghai',
  'Asia/Istanbul': 'Europe/Istanbul',
  'Asia/Kashgar': 'Asia/Urumqi',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Macao': 'Asia/Macau',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Tel_Aviv': 'Asia/Jerusalem',
  'Asia/Thimbu': 'Asia/Thimphu',
  'Asia/Ujung_Pandang': 'Asia/Makassar',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Atlantic/Jan_Mayen': 'Europe/Berlin',
  'Australia/ACT': 'Australia/Sydney',
  'Australia/Canberra': 'Australia/Sydney',
  'Australia/LHI': 'Australia/Lord_Howe',
  'Australia/NSW': 'Australia/Sydney',
  'Australia/North': 'Australia/Darwin',
  'Australia/Queensland': 'Australia/Brisbane',
  'Australia/South': 'Australia/Adelaide',
  'Australia/Tasmania': 'Australia/Hobart',
  'Australia/Victoria': 'Australia/Melbourne',
  'Australia/West': 'Australia/Perth',
  'Australia/Yancowinna': 'Australia/Broken_Hill',
  'Europe/Belfast': 'Europe/London',
  'Europe/Kiev': 'Europe/Kyiv',
  'Europe/Nicosia': 'Asia/Nicosia',
  'Europe/Tiraspol': 'Europe/Chisinau',
  'Europe/Uzhgorod': 'Europe/Kyiv',
  'Europe/Zaporozhye': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Johnston': 'Pacific/Honolulu',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Samoa': 'Pacific/Pago_Pago',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Pacific/Yap': 'Pacific/Chuuk',
}

// 한국어로도 찾을 수 있게 하는 도시 이름 (검색용, 표시는 IANA 이름)
const KOREAN_NAMES: Record<string, string> = {
  'Asia/Seoul': '서울',
  'Asia/Tokyo': '도쿄',
  'Asia/Shanghai': '상하이 베이징 중국',
  'Asia/Hong_Kong': '홍콩',
  'Asia/Taipei': '타이베이',
  'Asia/Singapore': '싱가포르',
  'Asia/Ho_Chi_Minh': '호찌민 베트남',
  'Asia/Bangkok': '방콕',
  'Asia/Jakarta': '자카르타',
  'Asia/Kolkata': '콜카타 인도',
  'Asia/Dubai': '두바이',
  'Europe/London': '런던 영국',
  'Europe/Paris': '파리 프랑스',
  'Europe/Berlin': '베를린 독일',
  'America/New_York': '뉴욕',
  'America/Los_Angeles': '로스앤젤레스 엘에이',
  'America/Chicago': '시카고',
  'Australia/Sydney': '시드니',
  UTC: '협정 세계시',
}

const REGION = /^(Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\//

export function canonicalZone(zone: string): string {
  return BACKWARD[zone] ?? zone
}

export interface ZoneOption {
  zone: string
  /** UTC 오프셋(분). 정렬과 검색에 쓴다 */
  offset: number
  /** "Asia/Seoul (UTC+09:00)" */
  label: string
  /** "UTC+09:00" */
  utc: string
  search: string
}

/** 지금 시점의 UTC 오프셋(분, 서머타임 반영) */
function offsetMinutes(zone: string, now: Date): number | null {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')?.value
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(part ?? '')
    if (!m) return 0 // "GMT"만 있으면 UTC+00:00
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
  } catch {
    return null
  }
}

function utcLabel(offset: number): string {
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

function option(zone: string, source: string, now: Date): ZoneOption | null {
  // 정식 이름을 모르는 오래된 ICU에서는 원래(옛) 이름으로 오프셋을 구한다.
  const offset = offsetMinutes(zone, now) ?? offsetMinutes(source, now)
  if (offset === null) return null
  const utc = utcLabel(offset)
  // "+9", "+5:30"처럼 앞자리 0 없이도 찾게 한다
  const abs = Math.abs(offset)
  const hours = `${offset < 0 ? '-' : '+'}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, '0')}` : ''}`
  return {
    zone,
    offset,
    label: `${zone} (${utc})`,
    utc,
    search: [zone, zone.replaceAll('_', ' '), KOREAN_NAMES[zone] ?? '', utc, hours].join(' ').toLowerCase(),
  }
}

/** 지역/도시 형식만 정식 이름으로, 오프셋 순·이름순. UTC를 하나 더한다 */
export function zoneOptions(now: Date = new Date()): ZoneOption[] {
  const byZone = new Map<string, ZoneOption>()
  for (const source of [...Intl.supportedValuesOf('timeZone'), 'UTC']) {
    const zone = canonicalZone(source)
    if (byZone.has(zone) || (zone !== 'UTC' && !REGION.test(zone))) continue
    const o = option(zone, source, now)
    if (o) byZone.set(zone, o)
  }
  return [...byZone.values()].sort((a, b) => a.offset - b.offset || a.zone.localeCompare(b.zone))
}

/** 검색: IANA 이름·도시 이름(한국어 포함)·오프셋("+9", "UTC+09") */
export function matchZone(o: ZoneOption, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return q.split(/\s+/).every((word) => o.search.includes(word))
}

export function detectedZone(): string | null {
  try {
    return canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  } catch {
    return null
  }
}

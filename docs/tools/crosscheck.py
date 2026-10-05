"""요구사항(필수·권장, P0~P4) 중 작업계획서 WBS에서 참조되지 않는 ID를 찾고,
두 문서가 참조하는 결정 ID(D-nn)가 결정기록.md에 있는지 검사한다."""
import os
import re
import sys
import zipfile

PREFIX = r'(AUTH|TASK|SCH|REC|TIME|LOG|EXP|NOTI|STAT|UX|NFR)'


def rows(path):
    xml = zipfile.ZipFile(path).read('word/document.xml').decode('utf-8')
    for tr in re.findall(r'<w:tr[ >].*?</w:tr>', xml, re.S):
        cells = [''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', tc)) for tc in re.findall(r'<w:tc>.*?</w:tc>', tr, re.S)]
        yield cells


def text(path):
    xml = zipfile.ZipFile(path).read('word/document.xml').decode('utf-8')
    return ' '.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>', xml))


def expand(text):
    """'TASK-01, 02, 05' / 'EXP-01~04' / 'AUTH-06, NFR-10' 같은 참조 표기를 개별 ID로 펼친다."""
    ids, prefix = set(), None
    for token in re.split(r',\s*', text):
        m = re.match(PREFIX + r'-(\d+)(?:~(\d+))?$', token.strip())
        if m:
            prefix, start, end = m.group(1), int(m.group(2)), int(m.group(3) or m.group(2))
        elif prefix and re.match(r'^\d+$', token.strip()):
            start = end = int(token.strip())
        else:
            continue
        ids.update(f'{prefix}-{n:02d}' for n in range(start, end + 1))
    return ids


srs_path, plan_path = sys.argv[1], sys.argv[2]
decisions_path = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '결정기록.md')
required = {c[0] for c in rows(srs_path)
            if len(c) == 5 and re.match(PREFIX + r'-\d+$', c[0]) and c[3] in ('필수', '권장') and c[4].startswith('P')}
defined = {c[0] for c in rows(srs_path) if len(c) == 5 and re.match(PREFIX + r'-\d+$', c[0])}
nfr = {c[0] for c in rows(srs_path) if len(c) == 3 and re.match(r'NFR-\d+$', c[0])}
referenced = set()
for c in rows(plan_path):
    if len(c) in (4, 5) and re.match(r'(P\d|U\d)-\d+$', c[0]):
        referenced |= expand(c[3])

print('MVP 기능 요구사항:', len(required), '/ NFR:', len(nfr))
print('WBS에서 빠진 기능 요구사항:', sorted(required - referenced) or '없음')
print('WBS에서 빠진 NFR (정보):', sorted(nfr - referenced) or '없음')
print('WBS가 참조하지만 정의서에 없는 ID:', sorted(referenced - defined - nfr) or '없음')

decided = set(re.findall(r'^\|\s*(D-\d+)\s*\|', open(decisions_path, encoding='utf-8').read(), re.M))
cited = set(re.findall(r'D-\d+', text(srs_path) + ' ' + text(plan_path)))
print('결정기록의 결정:', len(decided), '/ 두 문서가 참조하는 결정:', len(cited))
print('결정기록에 없는 결정 참조:', sorted(cited - decided) or '없음')

# 오늘뭐먹지 — Design System

> v0.2 · 2026-08-20
> 레퍼런스: Airbnb Design Language (Airbnb Cereal 타이포, 코랄 포인트, 카드 기반 레이아웃)

---

## 1. 방향 전환 메모

v0.1은 Litebox(다크·네온 에이전시 톤)를 레퍼런스로 삼았다. v0.2는 **에어비앤비**로 레퍼런스를 바꾼다.
이유: 에어비앤비는 "낯선 곳에서 신뢰할 수 있는 선택을 돕는다"는 문제의식이 우리 서비스("낯선 동네에서 단골을 만든다")와 정확히 겹친다. 카드 기반으로 장소를 탐색하게 하는 패턴, 부드러운 라운드와 넉넉한 여백으로 신뢰감을 주는 톤을 그대로 가져온다.

| 요소 | 에어비앤비 | 오늘뭐먹지 |
|---|---|---|
| 배경 | 화이트 + 라이트 그레이 섹션 구분 | ✅ 계승 — 화이트 기본, 그레이 섹션 |
| 포인트 컬러 | 코랄/핑크(Rausch #FF385C) | ✅ 계승 — 코랄을 Primary로, 탠저린을 보조 음식색으로 |
| 카드 | 큰 라운드, 옅은 그림자, hover 리프트 | ✅ 계승 — 검색결과·저장목록 카드에 그대로 적용 |
| 타이포 | Airbnb Cereal, 절제된 굵기(600~800) | 🔄 번역 — Pretendard로 대체, 굵기는 900→800으로 하향 절제 |
| 버튼 | Pill 또는 큰 radius, 단일 강조색 | ✅ 계승 |
| 인풋/검색바 | 알약형, 큰 터치 영역, 그림자로 입체감 | ✅ 계승 — 검색바에 적극 반영 |
| 필터 칩 | 라운드 사각형, 선택 시 다크 배경 | 🔄 번역 — 선택 시 코랄 배경으로 (브랜드 통일) |

**핵심 원칙:** 화려한 장식보다 **여백과 카드 위계**로 신뢰를 준다. 색은 코랄 하나로 절제하고, 나머지는 그레이스케일 + 음식색 소량.

---

## 2. 컬러

```css
/* Neutral */
--ink:        #222222;   /* 본문·헤드라인 (Airbnb 다크 그레이) */
--ink-2:      #6A6A6A;   /* 보조 텍스트 */
--ink-3:      #A0A0A0;   /* 힌트, 플레이스홀더 */
--bg:         #FFFFFF;   /* 페이지 기본 배경 */
--bg-soft:    #F7F7F7;   /* 섹션 구분 배경 (Airbnb 라이트 그레이) */
--white:      #FFFFFF;   /* 카드 표면 */
--border:     #DDDDDD;   /* 카드·인풋 보더 */
--border-soft:rgba(34,34,34,.08);

/* Brand / Accent */
--coral:      #FF385C;   /* Primary. 버튼·링크·선택 상태 */
--coral-dark: #E31C5F;   /* hover/active */
--coral-soft: #FFE8EC;   /* 코랄 배경 틴트 (배지, 하이라이트) */
--tangerine:  #FF9F1C;   /* 보조 강조 — 음식 아이콘, 취향 일치 배지 */
--butter:     #FFD34D;   /* 장식 전용 */
--basil:      #1F9D55;   /* 긍정·검증 신호 (걸러진 리뷰 vs 남은 리뷰) */
```

### 사용 규칙
- **Primary 액션(버튼·CTA·선택된 칩)은 `--coral` 하나.** 경쟁하는 강조색 금지.
- 배경 위계: `bg`(기본) → `bg-soft`(구분 섹션) → `white`(카드). 3단계 초과 금지.
- `--basil`은 "검증됨" 의미 전용, 장식 금지.
- 다크 섹션(최종 CTA 등)은 `--ink`를 배경으로 써서 대비를 준다 — 에어비앤비도 강조 섹션에 다크를 섞는다.

### 대비
| 조합 | 판정 |
|---|---|
| `--ink` on `--bg` | AAA |
| `--ink-2` on `--bg` | AA |
| `#FFF` on `--coral` | AA |
| `--coral` on `--white` | AA (텍스트 크기 한정) |

---

## 3. 타이포그래피

```css
font-family: 'Pretendard Variable', 'Pretendard', -apple-system,
             'Apple SD Gothic Neo', 'Segoe UI', system-ui, sans-serif;
```

에어비앤비 Cereal은 헤드라인도 과하게 두껍지 않다(600~800 범위). Pretendard 900은 너무 무거우므로 **최대 800**으로 하향한다.

| 이름 | 크기 | 굵기 | 자간 | 행간 |
|---|---|---|---|---|
| Display | `clamp(2.4rem, 6.5vw, 5rem)` | 800 | `-0.03em` | 1.08 |
| H1 | `clamp(1.9rem, 4.4vw, 3.1rem)` | 800 | `-0.025em` | 1.16 |
| H2 | `clamp(1.35rem, 3vw, 2rem)` | 700 | `-0.02em` | 1.28 |
| Body-L | `1.125rem` | 500 | `-0.01em` | 1.65 |
| Body | `1rem` | 500 | `-0.005em` | 1.7 |
| Label | `0.8125rem` | 600 | `0.04em` | 1.4 |

**규칙**
- 헤드라인 자간은 살짝만 조인다 (에어비앤비는 타이트하지 않고 여유 있는 편).
- 본문 한 줄 최대 68자.
- Label은 과한 대문자·자간 확장 대신 절제된 세미볼드.

---

## 4. 스페이싱 · 레이아웃

```css
--sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
--sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;
--sp-9: 96px; --sp-10: 128px;
```

- 컨테이너 최대 폭 **1200px**, 좌우 패딩 `clamp(20px, 5vw, 48px)`
- 섹션 상하 여백 `clamp(64px, 10vw, 140px)` — 에어비앤비식 넉넉하지만 무겁지 않은 호흡
- 모바일 우선

### 라운딩 · 그림자

```css
--r-pill: 999px;   /* 버튼, 검색바, 칩 */
--r-lg:   20px;    /* 카드 (에어비앤비 카드 radius) */
--r-md:   14px;    /* 인풋, 작은 카드 */
--r-sm:   10px;    /* 배지, 작은 요소 */

--shadow-sm: 0 1px 2px rgba(0,0,0,.08), 0 1px 4px rgba(0,0,0,.06);
--shadow-md: 0 6px 16px rgba(0,0,0,.12);
--shadow-lg: 0 12px 32px rgba(0,0,0,.16);
--shadow-search: 0 3px 12px rgba(0,0,0,.14); /* 에어비앤비 검색바 특유의 입체감 */
```

에어비앤비 그림자는 중성 그레이 기반(따뜻한 색을 섞지 않음)으로, 카드가 배경 위에 "떠 있는" 느낌을 준다.

---

## 5. 컴포넌트

### 버튼
```
Primary   배경 --coral / 텍스트 #FFF / radius --r-pill / 패딩 16px 32px / 700
          hover: 배경 --coral-dark
Secondary 배경 투명 / 1px 보더 --ink / 텍스트 --ink / radius --r-pill
          hover: 배경 --bg-soft
Ghost     텍스트만 + 밑줄 hover
```
전환은 `160ms ease` — 에어비앤비는 리프트보다 **색 전환 위주**의 절제된 hover를 쓴다.

### 카드
`--white` 배경 + `--r-lg` + `--shadow-sm` + `1px solid --border-soft`.
hover 시 `--shadow-md`로 전환(리프트는 최소화, `translateY(-2px)` 정도).

### 인풋 / 검색바
- 알약형(`--r-pill`) 또는 `--r-md`, 보더 `1px solid --border`
- 포커스 시 보더 `--ink` 2px + `--shadow-search`
- 검색바는 아이콘 + 텍스트 + 구분선으로 섹션을 나누는 에어비앤비 스타일 허용(카테고리 | 지역 | 검색 버튼)

### 칩 / 필터
pill 또는 라운드 사각형, 1px 보더. 선택 시 배경 `--coral`, 텍스트 흰색. hover 시 보더만 `--ink`로 강조(색 배경 없음).

---

## 6. 모션

| 상황 | 처리 |
|---|---|
| 스크롤 진입 | `opacity 0→1`, `translateY 20px→0`, 480ms |
| 카드 hover | `translateY(-2px)` + shadow 전환, 160ms |
| 버튼 hover | 배경색 전환, 160ms |
| `prefers-reduced-motion: reduce` | 모든 모션 정지 |

---

## 7. 보이스 & 카피 (변경 없음)

- 사용자의 실제 말투를 그대로 쓴다.
- 금지어: 찐맛집, 인생맛집, 성지, 강추
- 숫자는 구체적으로: "30초", "도보 5분"

---

## 8. 접근성 체크리스트

- [x] 텍스트 대비 4.5:1 이상
- [x] 포커스 링: `outline: 2px solid var(--ink); outline-offset: 2px`
- [x] 터치 타겟 44×44px 이상
- [x] 온보딩 진행률 `aria-valuenow`
- [x] 장식용 SVG `aria-hidden="true"`
- [x] `prefers-reduced-motion` 대응
- [x] 색만으로 정보 전달 금지 — 배지는 아이콘 + 텍스트 병기

---

## 9. 파일 구성

- `style.css` — 위 토큰(:root 변수) + 공통 컴포넌트(버튼/카드/인풋) + `index.html` 전용 스타일
- `save.css` — 맛집 담기 페이지(`save.html`, logic 팀원 작업) 전용 스타일. 검색바·필터·검색결과 카드·담은 목록 UI.
  실제 `save.html`의 class명이 확정되면 `save.css`의 선택자를 맞춰 조율 필요 (하단 "가정한 class 목록" 참고, save.css 상단 주석에도 명시됨).

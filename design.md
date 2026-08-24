# 오늘뭐먹지 — Design System

> v0.4 · 2026-08-24
> 레퍼런스: Airbnb Design Language (Airbnb Cereal 타이포, 코랄 포인트, 카드 기반 레이아웃)

---

## 0. 변경 요약

### v0.4 — 리뷰 패널 (구글 리뷰보기) 스타일 확정, logic/design 병렬 작업 마무리
logic이 "가게 클릭 → 리뷰 패널 열림" 기능 구현을 완료해 정확한 구조를 전달받았다. `save.css`에 `.review-panel`/`.review-item` 계열 스타일을 추가했다.

- **배치:** `.review-panel`은 모달/오버레이가 아니라 `.search-results`와 `.saved-list` 사이에 놓이는 일반 `<section>`. 기본 `[hidden]` 속성으로 숨겨져 있다가 카드 클릭 시 JS가 속성을 제거하며 나타난다. `position:fixed`/backdrop 류는 전혀 쓰지 않았다.
- **톤 선택:** `.saved-list`(`--bg-soft` 상시 노출 컨테이너)가 아니라 `.panel`/`.place-card`와 같은 **흰 배경 + `--shadow-sm` + `--r-lg`** "카드" 레시피를 그대로 재사용했다. 이유: `.saved-list`는 "항상 떠 있는 보관함" 성격이고, `.review-panel`은 "클릭해야 나타나는 상세 보기"로 성격이 달라 같은 `--bg-soft` 톤을 쓰면 바로 아래 `.saved-list`와 시각적으로 뭉쳐 보인다. 흰 카드로 만들어 두 섹션 사이에서 하나의 독립된 레이어처럼 구분되게 했다.
- **`.review-item`은 `.rcard`와 같은 "흰 카드 안의 중첩 카드" 공식**(`--bg-soft` 배경 + `--r-md` + `--border-soft` 보더, 그림자 없음)을 그대로 따랐다 — 이미 4장/5장에 있는 "카드 안에 카드가 있을 때는 흰색을 반복하지 않고 `--bg-soft`로 내려간다"는 규칙의 재적용이다.
- **`[hidden]` 처리 주의사항(구현 메모):** `.review-panel`은 레이아웃을 위해 `display:flex`를 직접 지정하므로, 브라우저 기본 `[hidden]{display:none}` 규칙과 동일 특이도에서 충돌해 숨김이 깨질 수 있다 — `.review-panel[hidden]{display:none}`을 명시적으로 되살려 방지했다. `.review-panel__loading`/`__not-found`/`__map-link`는 자체 `display`를 지정하지 않아(맵 링크는 flex item으로 자동 blockify) 이 문제가 애초에 발생하지 않는다.
- **색:** `.review-item__rating`/`.review-panel__rating` 텍스트에는 JS가 이미 "★ 4.5" 처럼 별 문자를 포함해 내려주므로, `.place-card__rating`처럼 CSS `::before`로 별을 추가하지 않았다(중복 방지). 색은 계속 `--coral` 하나로 절제하고, 지도 링크(`.review-panel__map-link`)만 `--coral` 텍스트 링크로 처리했다.
- **`.review-panel__close-btn`**은 문서 5장 **Secondary** 버튼 스펙(보더 `--ink` + hover 배경 `--bg-soft`)을 축소판으로 재사용했다 — `.place-card__save-btn`의 비활성-이전 상태와 동일한 톤.

이로써 이번 스프린트의 logic/design 병렬 작업(구글 플레이스 검색 연동 + 리뷰 패널)에 대한 디자인 대응을 마무리한다.

### v0.3.1 — 구글 플레이스 연동 실제 구조 반영
logic 팀원이 구글 플레이스 검색 연동을 완료하면서 v0.3의 추측이 실제와 달랐던 부분을 정정했다.

- `.place-card__source`(카카오/구글 출처 뱃지)가 실제로는 `.place-card`의 **항상 존재하는 첫 번째 자식**으로 확정 — 신규 스타일 추가. `category`(order:-1)보다 위에 오도록 `order:-2`를 줘서 배지 두 줄이 카드 상단에 쌓이게 했고, `.place-card[data-source="google"] .place-card__source`에 `--coral-soft`/`--coral` 톤을 얹어 구글 출처만 살짝 구분했다(카카오는 기존 `--bg-soft`/`--ink-2` 유지 — 색을 남용하지 않기 위해 차이는 최소화).
- `.place-card__rating`은 평범한 `<p>`이고 **값이 있을 때만 DOM에 붙는 조건부 렌더링**임이 확인됨 — v0.3에서 준비했던 배지+`data-empty` 스타일은 "안 그려짐"과 "빈 뱃지"를 혼동한 설계였다. `data-empty` 관련 CSS는 제거하고, phone/address와 같은 톤의 텍스트 라인(별 아이콘 접두사만 유지)으로 단순화했다.
- `.place-card__photo`/`.place-card__photo-wrap`은 이번 범위에서 **구현 보류**(Google Text Search 응답만으로는 사진을 못 가져옴, 별도 Photo API 필요) — 코드는 삭제하지 않고 향후 재사용 대기 상태로 남김.

### v0.3 — style.css/save.css 시스템 정합성 정비
**style.css**
- `:root`에 4장에 정의만 되어 있고 실제로는 선언이 빠져 있던 스페이싱 스케일(`--sp-1`~`--sp-10`)을 추가. 카드 그리드 간격(`.stack`, `.rcards`)이 임의값(14px)이었던 것을 `--sp-4`(16px)로 통일.
- "카드" 컴포넌트 규칙(`--white` + `--r-lg` + **`--shadow-sm` 기본** + hover 시 `--shadow-md`)을 어기고 기본 그림자가 없던 `.step`, `.panel`에 `--shadow-sm`을 추가.
- 카드 hover 리프트 값이 컴포넌트마다 제각각(-2px / -3px)이던 것을 문서 스펙(`translateY(-2px)`)으로 통일 (`.step`, `.rcard`).
- 푸터 내비게이션 링크 hover에 밑줄을 추가해 5장의 Ghost 버튼 규칙("텍스트만 + 밑줄 hover")과 실제 구현을 일치시킴.
- 마크업의 `.btn-ghost`는 실제로는 본 문서의 **Secondary** 스펙(보더 + hover 시 `--bg-soft`)을 구현한 것이며, 순수 텍스트형 Ghost는 별도 버튼 class 없이 푸터·인라인 링크에 자연 적용된다 — 5장에 구현 노트로 명시.

**save.css**
- `logic` 팀원이 구글 플레이스 API 연동으로 `.place-card`에 사진·평점 필드를 추가할 것에 대비해 클래스를 선제 준비함(이후 v0.3.1에서 실제 구조에 맞춰 조정됨, 위 참고).

(리뷰 패널 관련 예정 작업 메모는 v0.4에서 구현 완료로 해소됨 — 위 "v0.4" 항목 참고.)

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
`style.css`의 `:root`에 실제 선언됨(v0.3 이전에는 문서에만 있고 코드에 누락돼 있었음). 고정폭 간격(그리드 gap, 카드 내부 margin 등)은 이 스케일 값을 쓰고, 섹션 상하 여백처럼 화면폭에 따라 유동적이어야 하는 값은 계속 `clamp()`를 쓴다.

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

> **구현 노트(v0.3):** 실제 마크업(`index.html`)의 class는 `.btn-ghost` 하나로 통일되어 있고, 이는 위 **Secondary** 스펙(보더 1px `--ink` + hover 시 배경 `--bg-soft`)을 구현한 것이다. 순수 텍스트형 **Ghost**(텍스트만 + 밑줄 hover)는 별도 버튼 class 없이 푸터·인라인 텍스트 링크에 자연스럽게 적용한다(`style.css`의 `.foot nav a:hover` 참고).

### 카드
`--white` 배경 + `--r-lg` + `--shadow-sm` + `1px solid --border-soft`.
hover 시 `--shadow-md`로 전환(리프트는 최소화, `translateY(-2px)` 정도). 이 기본 그림자·hover 리프트 값은 `.step`, `.panel`, `.rcard`, `save.css`의 `.place-card` 등 카드형 요소 전체에 동일하게 적용해 시각적 위계를 통일한다(v0.3에서 `.step`/`.panel`에 누락돼 있던 기본 `--shadow-sm`과, `.step`/`.rcard`가 `-3px`로 어긋나 있던 hover 리프트 값을 스펙대로 정정함).

#### 카드 — 구글 플레이스 신규 필드 (v0.3.1, logic 확정 구조 반영)
`logic` 팀원이 구글 플레이스 검색 연동을 완료했다. v0.3에서 세웠던 가정 중 실제와 다른 부분이 있어 아래처럼 정정했다.

| 요소 | 실제 구조 | 결정 |
|---|---|---|
| `.place-card__source` | `<span>`, `.place-card`의 항상 존재하는 첫 번째 자식(이름 앞). `.place-card`에 `data-source="kakao"\|"google"`도 부여됨 | `category`와 같은 톤의 작은 pill 배지(`--r-pill`, `--bg-soft`/`--ink-2`)로 상단에 쌓는다. `category`(order:-1)보다 먼저 오도록 `order:-2` 부여. 구글 결과만 `--coral-soft`/`--coral`로 살짝 틴트해 "새로 연동된 소스"임을 은근히 구분 — `--coral`을 배지 배경 전체가 아닌 연한 틴트로만 쓰고 카카오는 손대지 않아 "Primary 색은 하나, 남용 금지" 원칙을 지킨다. |
| `.place-card__rating` | 평범한 `<p>`, phone 다음/link 이전 위치. **값이 있을 때만 DOM에 붙는 조건부 렌더링**(빈 상태로 존재하지 않음) | v0.3에서 준비했던 pill 배지 + `data-empty` 톤다운 상태는 폐기 — 엘리먼트 자체가 없을 때를 "빈 뱃지"로 잘못 가정한 설계였다(해당 상태는 렌더링 조건상 영원히 트리거될 수 없는 죽은 코드였음). 대신 `address`/`phone`과 같은 톤의 텍스트 라인으로 단순화하고, 별 아이콘(`::before`, `--tangerine`)만 접두어로 유지했다. |
| `.place-card__photo` / `__photo-wrap` | **구현 보류.** Google Text Search 응답만으로는 사진을 못 가져오고 별도 Photo API 호출이 필요해 이번 범위에서 제외됨 | 스타일은 삭제하지 않고 보류 상태로 남김(풀블리드 썸네일, `aspect-ratio 4/3`, 상단 모서리만 `--r-lg`). 추후 사진 필드가 붙으면 class명만 맞춰 그대로 재사용. |

#### 카드 — 리뷰 패널 (v0.4, logic 확정 구조 반영)
"가게 클릭 → 리뷰 패널 열림" 기능. `.review-panel`은 `.search-results`와 `.saved-list` 사이의 일반 `<section>`이며 기본 `[hidden]`, 카드 클릭 시 JS가 속성을 제거해 노출한다(모달 아님).

| 요소 | 결정 |
|---|---|
| `.review-panel` (컨테이너) | `.saved-list`의 `--bg-soft` 상시 컨테이너 톤 대신, `.panel`/`.place-card`와 동일한 **흰 배경 + `--r-lg` + `--shadow-sm`** "카드" 레시피를 그대로 재사용. "항상 떠 있는 목록"(`.saved-list`)과 "클릭해야 나타나는 상세 보기"(`.review-panel`)의 성격 차이를 톤으로 구분하기 위함. |
| `.review-item` (리뷰 한 건) | `.rcard`와 동일한 "흰 카드 안의 중첩 카드" 공식 — `--bg-soft` 배경 + `--r-md` + `1px solid --border-soft`, 그림자 없음. 저자/평점/작성일을 한 줄에 두고(`flex-wrap` + `margin-left:auto`로 날짜만 우측 정렬) 리뷰 본문은 `flex-basis:100%`로 다음 줄에 전체 폭으로 배치. |
| `.review-panel__rating` / `.review-item__rating` | JS가 내려주는 텍스트에 이미 "★" 문자가 포함돼 있어(`"★ 4.5 (리뷰 128개)"`, `"★ 5"`) `.place-card__rating`처럼 `::before`로 별을 추가하지 않았다(중복 방지). 색은 `--ink`로 절제. |
| `.review-panel__close-btn` | 5장 **Secondary** 버튼 스펙(보더 `--ink` + hover 배경 `--bg-soft`)의 축소판. |
| `.review-panel__map-link` | `.place-card__link`와 동일한 텍스트 링크 톤(`--coral`, hover 밑줄). |
| `[hidden]` 처리 | `.review-panel`이 `display:flex`를 직접 지정하므로 브라우저 기본 `[hidden]{display:none}`과 특이도가 같아 묻힐 수 있다 — `.review-panel[hidden]{display:none}`을 명시적으로 되살렸다. `__loading`/`__not-found`/`__map-link`는 자체 `display`를 지정하지 않아(맵 링크는 flex item이라 자동 blockify) 이 문제가 발생하지 않는다. |

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
  실제 `save.html`의 class명이 확정되면 `save.css`의 선택자를 맞춰 조율 필요 (아래 "가정한 class 목록" 참고, save.css 상단 주석에도 명시됨).

### 구글 플레이스 연동 class 현황 (save.html 구조 기준)

`save.html`에서 확정된 구조(`.save-page`, `.search-panel`, `.place-card`, `.saved-item`, `.review-panel`, `.review-item` 등 BEM 계열)는 `save.css` 상단 주석에 전체 트리로 정리돼 있다. 구글 플레이스 연동으로 추가된 필드의 현재 상태는 다음과 같다:

| class | 용도 | 상태 |
|---|---|---|
| `.place-card__source` | 검색결과 출처 뱃지(카카오/구글), `.place-card`의 항상 존재하는 첫 자식 | 구현됨 (v0.3.1, logic 확정) |
| `.place-card__rating` | 평점 텍스트, 값 있을 때만 조건부 렌더링되는 `<p>` | 구현됨 (v0.3.1, logic 확정) |
| `.place-card__photo-wrap` / `.place-card__photo` | 사진 썸네일 | 스타일만 존재, **구현 보류**(Google Photo API 미연동) |
| `.review-panel` 및 하위 요소(`__header`, `__name`, `__close-btn`, `__rating`, `__loading`, `__not-found`, `__list`, `__map-link`), `.review-item` 및 하위 요소(`__author`, `__rating`, `__date`, `__content`) | "가게 클릭 → 리뷰 패널" 기능 | 구현됨 (v0.4, logic 확정) |

이번 스프린트의 logic(구글 플레이스 검색 + 리뷰 패널)/design(스타일링) 병렬 작업은 v0.4로 마무리됐다. `.place-card__photo`만 API 제약으로 보류 상태이며, 나머지는 모두 실제 마크업과 스타일이 일치한다.

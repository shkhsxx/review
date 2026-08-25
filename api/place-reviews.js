// api/place-reviews.js
// 구글 Places API (New)를 이용해 특정 가게의 별점/리뷰를 조회하는 프록시.
// Vercel Serverless Function — 이 파일이 자동으로 GET /api/place-reviews 로 매핑된다.
// (기존 netlify/functions/place-reviews.js와 동일한 로직, req/res 포맷만 Vercel에 맞춤)
//
// 환경변수 (Vercel 프로젝트 설정 > Environment Variables):
//   GOOGLE_PLACES_API_KEY   구글 클라우드 콘솔에서 발급받은 Places API 키 (필수)
//                           ※ Cloud 콘솔에서 "Places API (New)"를 별도로
//                             사용 설정(enable)해야 한다.
//
// 호출 경로: GET /api/place-reviews?name=<가게이름>&x=<경도>&y=<위도>
//
// 동작:
//   1) Text Search (New)로 이름 기준 후보를 찾는다.
//   2) 후보 위치와 원래 좌표(x, y) 사이 거리를 Haversine 공식으로 계산해
//      도보 2분(150m) 반경 안에 있는 후보만 인정한다.
//   3) 반경 안에서 가장 가까운 후보 1곳만 골라 Place Details (New)로 별점/리뷰/지도
//      링크를 가져온다.
//
// 응답 형태:
//   찾음:   { found: true,  place: { name, rating, userRatingCount, reviews, mapsUri } }
//   못 찾음: { found: false }

const SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const DETAILS_BASE_URL = "https://places.googleapis.com/v1/places";

const MATCH_RADIUS_METERS = 150; // 도보 2분 반경
const SEARCH_FIELD_MASK = "places.id,places.displayName,places.location";
const DETAILS_FIELD_MASK = "displayName,rating,userRatingCount,reviews,googleMapsUri";

// ---------- 협찬/체험단 의심 리뷰 판별 (규칙 기반 v1) ----------
// 구글 리뷰 API는 계정 가입일·하루 작성 건수 같은 이력 정보를 주지 않으므로
// 리뷰 본문 텍스트 신호만으로 판별한다. 삭제하지 않고 isAd/adReasons로 표시만 하고
// (F2 "필터링"은 "숨김"이 아니라 "왜 걸러졌는지 함께 보여주기"가 원칙 — 홈 화면 신뢰도
// 섹션 참고), AI 감성분석(save.js)에서는 제외한다.
// ※ server.py의 AD_STRONG_PATTERNS/AD_WEAK_PATTERNS와 반드시 동일하게 유지할 것.
const AD_STRONG_PATTERNS = [
  { re: /협찬/, reason: "협찬 문구 감지" },
  { re: /제공\s*받(았|아)/, reason: "제품/서비스 제공 문구 감지" },
  { re: /체험단/, reason: "체험단 문구 감지" },
  { re: /서포터즈/, reason: "서포터즈 문구 감지" },
  { re: /원고료/, reason: "원고료 문구 감지" },
  { re: /유료\s*광고/, reason: "유료 광고 문구 감지" },
  { re: /해당\s*(리뷰|게시물|포스팅)(은|는)/, reason: "정형화된 광고 고지 문구 감지" },
];

const AD_WEAK_PATTERNS = [
  /인생\s*맛집/,
  /찐\s*맛집/,
  /강추/,
  /적극\s*추천/,
  /무조건\s*(가세요|추천)/,
  /성지/,
  /존맛/,
];

const EXCESSIVE_EXCLAMATION = /!{3,}/;
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

/** 리뷰 본문 텍스트에서 협찬/체험단 의심 신호를 규칙 기반으로 찾는다. */
function detectAdReview(content) {
  const text = content || "";
  const reasons = new Set();

  for (const { re, reason } of AD_STRONG_PATTERNS) {
    if (re.test(text)) reasons.add(reason);
  }

  const weakHits = AD_WEAK_PATTERNS.filter((re) => re.test(text)).length;
  if (weakHits >= 2) reasons.add(`과장 표현 반복 (${weakHits}건)`);

  if (EXCESSIVE_EXCLAMATION.test(text)) reasons.add("느낌표 과다 사용");

  const emojiCount = (text.match(EMOJI_PATTERN) || []).length;
  if (emojiCount >= 3) reasons.add("이모지 과다 사용");

  return { isAd: reasons.size > 0, adReasons: [...reasons] };
}

/** 두 좌표(위도/경도) 사이의 거리를 미터 단위로 계산한다(Haversine 공식). */
function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Text Search (New)로 이름 기준 후보를 찾고, 150m 반경 안에서 가장 가까운 후보를 반환한다. */
async function searchCandidate(name, lat, lng, apiKey) {
  const res = await fetch(SEARCH_TEXT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: name,
      languageCode: "ko",
      maxResultCount: 5,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: MATCH_RADIUS_METERS,
        },
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    throw new Error(`구글 Places API(New) 검색 실패: ${message}`);
  }

  let closest = null;
  let closestDistance = Infinity;
  for (const candidate of data.places || []) {
    if (!candidate.location) continue;
    const distance = haversineDistanceMeters(
      lat,
      lng,
      candidate.location.latitude,
      candidate.location.longitude
    );
    if (distance <= MATCH_RADIUS_METERS && distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }
  return closest;
}

/** Place Details (New)로 화면 표시용 5개 필드(이름/별점/리뷰개수/리뷰/지도링크)를 가져온다. */
async function fetchDetails(placeId, apiKey) {
  const res = await fetch(`${DETAILS_BASE_URL}/${placeId}?languageCode=ko`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": DETAILS_FIELD_MASK,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    throw new Error(`구글 Places API(New) 상세 조회 실패: ${message}`);
  }
  return data;
}

/** Place Details(New) 응답을 화면에서 바로 쓰기 좋은 형태로 정리한다. */
function normalizeDetails(details, fallbackName) {
  return {
    name: (details.displayName && details.displayName.text) || fallbackName,
    rating: typeof details.rating === "number" ? details.rating : null,
    userRatingCount: typeof details.userRatingCount === "number" ? details.userRatingCount : 0,
    reviews: (details.reviews || []).map((review) => {
      const content =
        (review.text && review.text.text) ||
        (review.originalText && review.originalText.text) ||
        "";
      const { isAd, adReasons } = detectAdReview(content);
      return {
        author: (review.authorAttribution && review.authorAttribution.displayName) || "익명",
        rating: typeof review.rating === "number" ? review.rating : null,
        date: review.relativePublishTimeDescription || "",
        content,
        isAd,
        adReasons,
      };
    }),
    mapsUri: details.googleMapsUri || "",
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
    return;
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "서버에 GOOGLE_PLACES_API_KEY 환경변수가 설정되어 있지 않습니다." });
    return;
  }

  const name = String(req.query.name || "").trim();
  const x = parseFloat(req.query.x); // 경도
  const y = parseFloat(req.query.y); // 위도

  if (!name || Number.isNaN(x) || Number.isNaN(y)) {
    res.status(400).json({ error: "name, x, y 파라미터가 필요합니다." });
    return;
  }

  try {
    const candidate = await searchCandidate(name, y, x, apiKey);
    if (!candidate) {
      res.status(200).json({ found: false });
      return;
    }

    const details = await fetchDetails(candidate.id, apiKey);
    res.status(200).json({ found: true, place: normalizeDetails(details, name) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};

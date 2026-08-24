// netlify/functions/place-reviews.js
// 구글 Places API (New)를 이용해 특정 가게의 별점/리뷰를 조회하는 프록시.
// 같은 저장소의 places-google.js(레거시 Text Search)와는 별개의 최신 API 상품이다.
// New API는 POST + X-Goog-Api-Key / X-Goog-FieldMask 헤더 방식이며 응답 스키마도 다르다.
//
// 환경변수 (Netlify 사이트 설정 > Environment variables):
//   GOOGLE_PLACES_API_KEY   구글 클라우드 콘솔에서 발급받은 Places API 키 (필수)
//                           ※ 이 기능을 쓰려면 Cloud 콘솔에서 "Places API (New)"를
//                             별도로 사용 설정(enable)해야 한다. 레거시 "Places API"와는
//                             별개의 API 상품이라, places-google.js가 잘 동작하는 키라도
//                             New API가 비활성화돼 있으면 403 PERMISSION_DENIED가 발생한다.
//
// 배포 후 호출 경로: /api/place-reviews?name=<가게이름>&x=<경도>&y=<위도>
// (netlify.toml의 기존 /api/* 리다이렉트가 그대로 이 함수에 연결해준다.)
//
// 동작:
//   1) Text Search (New)로 이름 기준 후보를 찾는다. locationBias는 검색 편향일 뿐
//      강제 반경이 아니므로 결과 위치를 그대로 신뢰하지 않는다.
//   2) 후보 위치와 원래 좌표(x, y) 사이 거리를 Haversine 공식으로 직접 계산해
//      도보 2분(150m) 반경 안에 있는 후보만 인정한다. 반경 밖이면 못 찾은 것으로 처리한다.
//   3) 반경 안에서 가장 가까운 후보 1곳만 골라 Place Details (New)로 별점/리뷰/지도
//      링크를 가져온다. 검색 단계에서는 최소 필드(id/이름/좌표)만 요청하고, 비용이
//      큰 리뷰 등의 필드는 검증이 끝난 후보 1곳에 대해서만 요청해 과금을 최소화한다.
//
// 응답 형태:
//   찾음:   { found: true,  place: { name, rating, userRatingCount, reviews, mapsUri } }
//   못 찾음: { found: false }

const SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const DETAILS_BASE_URL = "https://places.googleapis.com/v1/places";

const MATCH_RADIUS_METERS = 150; // 도보 2분 반경
// 검색 단계: 후보 식별 + 거리 검증에 필요한 최소 필드만 요청(과금 최소화)
const SEARCH_FIELD_MASK = "places.id,places.displayName,places.location";
// 상세 단계: 화면에 보여줄 5개 정보(이름/별점/리뷰개수/리뷰/지도링크)만 요청
const DETAILS_FIELD_MASK = "displayName,rating,userRatingCount,reviews,googleMapsUri";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
};

/** 두 좌표(위도/경도) 사이의 거리를 미터 단위로 계산한다(Haversine 공식). */
function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // 지구 평균 반지름(m)
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
  const res = await fetch(`${DETAILS_BASE_URL}/${placeId}`, {
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
    reviews: (details.reviews || []).map((review) => ({
      author: (review.authorAttribution && review.authorAttribution.displayName) || "익명",
      rating: typeof review.rating === "number" ? review.rating : null,
      date: review.relativePublishTimeDescription || "",
      content:
        (review.text && review.text.text) ||
        (review.originalText && review.originalText.text) ||
        "",
    })),
    mapsUri: details.googleMapsUri || "",
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: "서버에 GOOGLE_PLACES_API_KEY 환경변수가 설정되어 있지 않습니다.",
      }),
    };
  }

  const name = (event.queryStringParameters?.name || "").trim();
  const x = parseFloat(event.queryStringParameters?.x); // 경도
  const y = parseFloat(event.queryStringParameters?.y); // 위도

  if (!name || Number.isNaN(x) || Number.isNaN(y)) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "name, x, y 파라미터가 필요합니다." }),
    };
  }

  try {
    const candidate = await searchCandidate(name, y, x, apiKey);
    if (!candidate) {
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ found: false }),
      };
    }

    const details = await fetchDetails(candidate.id, apiKey);
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ found: true, place: normalizeDetails(details, name) }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

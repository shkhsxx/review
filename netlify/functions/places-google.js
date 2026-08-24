// netlify/functions/places-google.js
// 구글 플레이스 API(Text Search) 프록시.
// search.js(카카오 로컬 API 프록시)와 동일한 스타일/구조를 따른다.
// 로컬 개발용 server.py(Python)와 동일한 역할을 Netlify Functions(Node)로 옮긴 것.
//
// 환경변수 (Netlify 사이트 설정 > Environment variables):
//   GOOGLE_PLACES_API_KEY   구글 클라우드 콘솔에서 발급받은 Places API 키 (필수)
//
// 배포 후 호출 경로: /api/places-google?query=...
// (netlify.toml의 기존 /api/* 리다이렉트가 :splat으로 이 함수명을 그대로
//  /.netlify/functions/places-google 에 연결해주므로 별도 리다이렉트 규칙은 필요 없다.)

const GOOGLE_PLACES_TEXTSEARCH_URL =
  "https://maps.googleapis.com/maps/api/place/textsearch/json";

// 구글 Text Search API로 그대로 넘겨도 되는 pass-through 쿼리 파라미터
const PASSTHROUGH_PARAMS = ["language", "region", "location", "radius", "type", "pagetoken"];

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
};

async function callGooglePlaces(params, apiKey) {
  const qs = new URLSearchParams({ ...params, key: apiKey }).toString();
  const res = await fetch(`${GOOGLE_PLACES_TEXTSEARCH_URL}?${qs}`);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
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

  const query = (event.queryStringParameters?.query || "").trim();
  if (!query) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "query 파라미터가 필요합니다." }),
    };
  }

  const params = { query };
  for (const key of PASSTHROUGH_PARAMS) {
    const value = event.queryStringParameters?.[key];
    if (value) params[key] = value;
  }

  try {
    const result = await callGooglePlaces(params, apiKey);
    return {
      statusCode: result.status,
      headers: JSON_HEADERS,
      body: JSON.stringify(result.data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: `구글 플레이스 API 호출 실패: ${err.message}` }),
    };
  }
};

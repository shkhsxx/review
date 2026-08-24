// api/places-google.js
// 구글 플레이스 API(레거시 Text Search) 프록시.
// Vercel Serverless Function — 이 파일이 자동으로 GET /api/places-google 로 매핑된다.
// (기존 netlify/functions/places-google.js와 동일한 로직, req/res 포맷만 Vercel에 맞춤)
//
// 환경변수 (Vercel 프로젝트 설정 > Environment Variables):
//   GOOGLE_PLACES_API_KEY   구글 클라우드 콘솔에서 발급받은 Places API 키 (필수)
//
// 호출 경로: GET /api/places-google?query=...

const GOOGLE_PLACES_TEXTSEARCH_URL =
  "https://maps.googleapis.com/maps/api/place/textsearch/json";

const PASSTHROUGH_PARAMS = ["language", "region", "location", "radius", "type", "pagetoken"];

async function callGooglePlaces(params, apiKey) {
  const qs = new URLSearchParams({ ...params, key: apiKey }).toString();
  const res = await fetch(`${GOOGLE_PLACES_TEXTSEARCH_URL}?${qs}`);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
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

  const query = String(req.query.query || "").trim();
  if (!query) {
    res.status(400).json({ error: "query 파라미터가 필요합니다." });
    return;
  }

  const params = { query };
  for (const key of PASSTHROUGH_PARAMS) {
    const value = req.query[key];
    if (value) params[key] = value;
  }

  try {
    const result = await callGooglePlaces(params, apiKey);
    res.status(result.status).json(result.data);
  } catch (err) {
    res.status(502).json({ error: `구글 플레이스 API 호출 실패: ${err.message}` });
  }
};

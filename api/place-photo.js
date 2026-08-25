// api/place-photo.js
// 구글 플레이스 API(레거시) 사진 프록시. api/places-google.js(Text Search)가 돌려주는
// photos[].photo_reference를 받아 실제 이미지 바이트를 대신 받아와 그대로 돌려준다.
// Vercel Serverless Function — 이 파일이 자동으로 GET /api/place-photo 로 매핑된다.
//
// 이렇게 서버를 한 번 거치는 이유: 구글 Photo 엔드포인트는 key 쿼리 파라미터로 인증하는데,
// 브라우저가 직접 호출하게 하면 API 키가 그대로 노출된다. 서버가 대신 호출해서 이미지
// 바이트만 클라이언트로 넘겨주면 키가 노출되지 않는다.
//
// 환경변수 (Vercel 프로젝트 설정 > Environment Variables):
//   GOOGLE_PLACES_API_KEY   구글 클라우드 콘솔에서 발급받은 Places API 키 (필수)
//
// 호출 경로: GET /api/place-photo?photo_reference=<참조값>&maxwidth=<px>

const GOOGLE_PHOTO_URL = "https://maps.googleapis.com/maps/api/place/photo";
const DEFAULT_MAX_WIDTH = 400;
const MAX_ALLOWED_WIDTH = 1600; // 과도한 트래픽/비용 방지용 상한

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

  const photoReference = String(req.query.photo_reference || "").trim();
  if (!photoReference) {
    res.status(400).json({ error: "photo_reference 파라미터가 필요합니다." });
    return;
  }

  const requestedWidth = parseInt(req.query.maxwidth, 10);
  const maxwidth = Number.isFinite(requestedWidth)
    ? Math.min(Math.max(requestedWidth, 1), MAX_ALLOWED_WIDTH)
    : DEFAULT_MAX_WIDTH;

  const upstreamUrl = `${GOOGLE_PHOTO_URL}?maxwidth=${maxwidth}&photo_reference=${encodeURIComponent(
    photoReference
  )}&key=${apiKey}`;

  try {
    const upstream = await fetch(upstreamUrl);
    if (!upstream.ok) {
      res.status(502).json({ error: `사진을 불러오지 못했습니다. (HTTP ${upstream.status})` });
      return;
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await upstream.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(200).send(buffer);
  } catch (err) {
    res.status(502).json({ error: `사진 조회 중 오류가 발생했습니다: ${err.message}` });
  }
};

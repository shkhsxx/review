// api/analyze-reviews.js
// Gemini API로 구글 리뷰의 감성분석(긍정/보통/부정 분류+개수, 핵심 키워드, 한줄 요약)을
// 수행하는 프록시. Vercel Serverless Function — 이 파일이 자동으로
// POST /api/analyze-reviews 로 매핑된다.
// (기존 netlify/functions/analyze-reviews.js와 동일한 로직, req/res 포맷만 Vercel에 맞춤)
//
// 환경변수 (Vercel 프로젝트 설정 > Environment Variables):
//   GEMINI_API_KEY   Google AI Studio에서 발급받은 Gemini API 키 (필수)
//   GEMINI_MODEL     사용할 Gemini 모델명 (기본값: gemini-3.6-flash).
//                     ai.google.dev에서 최신 추천 모델을 확인해 필요하면 바꿔준다.
//
// 호출 경로: POST /api/analyze-reviews
// body: { placeName: string, reviews: [{ author, rating, date, content }, ...] }
//
// 무료 사용량을 아끼기 위해 프론트엔드(save.js)가 sessionStorage에 분석 결과를
// 캐시해두고 같은 가게 재클릭 시 재호출하지 않는다. 리뷰가 없는 가게는 프론트에서
// 애초에 이 함수를 호출하지 않으므로, 여기서는 방어적으로만 검증한다.
//
// 응답 형태:
//   성공: { analyzed: true, result: { sentiment: {positive,neutral,negative}, keywords: [...], summary } }
//   실패: { error: "..." } (4xx/5xx)

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const geminiUrl = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// Gemini structured output(responseSchema)에 강제할 JSON 스키마.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    sentiment: {
      type: "OBJECT",
      properties: {
        positive: { type: "INTEGER" },
        neutral: { type: "INTEGER" },
        negative: { type: "INTEGER" },
      },
      required: ["positive", "neutral", "negative"],
    },
    keywords: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          word: { type: "STRING" },
          score: { type: "INTEGER" },
          sentiment: { type: "STRING", enum: ["positive", "negative"] },
        },
        required: ["word", "score", "sentiment"],
      },
    },
    summary: { type: "STRING" },
  },
  required: ["sentiment", "keywords", "summary"],
};

function buildPrompt(placeName, reviews) {
  const reviewLines = reviews
    .map((r, i) => `${i + 1}. (별점 ${r.rating ?? "?"}) ${r.content || "(내용 없음)"}`)
    .join("\n");

  return `너는 음식점 리뷰 분석가야. 아래는 '${placeName}'에 대한 구글 리뷰 ${reviews.length}건이다.

${reviewLines}

위 리뷰들을 분석해서 다음 세 가지를 수행하고, 반드시 지정된 JSON 스키마 형식으로만 답해라.
1. 각 리뷰를 긍정/보통/부정 중 하나로 분류하고 각각 몇 건인지 센다 (positive/neutral/negative, 합은 ${reviews.length}이어야 한다).
2. 리뷰에 자주 등장하는 핵심 단어를 8~15개 뽑는다. 음식 이름, 맛, 분위기, 서비스 관련 단어 위주로 고른다.
   각 단어마다 중요도(score, 1~10)와 그 단어가 쓰인 맥락이 긍정인지 부정인지(sentiment)를 표기한다.
3. 이 가게 리뷰 전체를 자연스러운 한국어 한 문장으로 요약한다(summary).

한국어로 답하라.`;
}

function clampScore(score) {
  const n = Math.round(Number(score));
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, n));
}

function normalizeAnalysis(raw) {
  const sentiment = raw.sentiment || {};
  const keywords = Array.isArray(raw.keywords) ? raw.keywords : [];
  const toCount = (value) => Math.max(0, Math.round(Number(value) || 0));

  return {
    sentiment: {
      positive: toCount(sentiment.positive),
      neutral: toCount(sentiment.neutral),
      negative: toCount(sentiment.negative),
    },
    keywords: keywords
      .filter((k) => k && typeof k.word === "string" && k.word.trim())
      .slice(0, 15)
      .map((k) => ({
        word: k.word.trim(),
        score: clampScore(k.score),
        sentiment: k.sentiment === "negative" ? "negative" : "positive",
      })),
    summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 지원합니다." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "서버에 GEMINI_API_KEY 환경변수가 설정되어 있지 않습니다." });
    return;
  }

  // Vercel Node 런타임은 Content-Type: application/json 요청 본문을 자동으로
  // req.body에 파싱해준다(문자열이면 방어적으로 한 번 더 파싱).
  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload || "{}");
    } catch {
      res.status(400).json({ error: "잘못된 요청 본문입니다." });
      return;
    }
  }
  payload = payload || {};

  const placeName = (payload.placeName || "").trim();
  const reviews = Array.isArray(payload.reviews)
    ? payload.reviews.filter((r) => r && r.content)
    : [];

  if (!placeName || !reviews.length) {
    res.status(400).json({ error: "placeName, reviews가 필요합니다." });
    return;
  }

  try {
    const geminiRes = await fetch(`${geminiUrl(GEMINI_MODEL)}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(placeName, reviews) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
    const data = await geminiRes.json().catch(() => ({}));
    if (!geminiRes.ok) {
      const message = (data && data.error && data.error.message) || `HTTP ${geminiRes.status}`;
      throw new Error(`Gemini API 호출 실패: ${message}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini 응답에서 분석 결과를 찾지 못했습니다.");

    const parsed = JSON.parse(text);
    res.status(200).json({ analyzed: true, result: normalizeAnalysis(parsed) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};

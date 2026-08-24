// netlify/functions/analyze-reviews.js
// Gemini API로 구글 리뷰의 감성분석(긍정/보통/부정 분류+개수, 핵심 키워드, 한줄 요약)을
// 수행하는 프록시. 로컬 개발용 server.py의 analyze_reviews()와 동일한 역할을 한다.
//
// 환경변수 (Netlify 사이트 설정 > Environment variables):
//   GEMINI_API_KEY   Google AI Studio에서 발급받은 Gemini API 키 (필수)
//   GEMINI_MODEL     사용할 Gemini 모델명 (기본값: gemini-3.6-flash).
//                     ai.google.dev에서 최신 추천 모델을 확인해 필요하면 바꿔준다.
//
// 배포 후 호출 경로: POST /api/analyze-reviews
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

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
};

// Gemini structured output(responseSchema)에 강제할 JSON 스키마.
// 세 가지 분석 결과(감성 분류+개수 / 핵심 키워드 / 한줄 요약)를 한 번의 호출로 받는다.
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

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "POST만 지원합니다." }),
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "서버에 GEMINI_API_KEY 환경변수가 설정되어 있지 않습니다." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "잘못된 요청 본문입니다." }),
    };
  }

  const placeName = (payload.placeName || "").trim();
  const reviews = Array.isArray(payload.reviews)
    ? payload.reviews.filter((r) => r && r.content)
    : [];

  if (!placeName || !reviews.length) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "placeName, reviews가 필요합니다." }),
    };
  }

  try {
    const res = await fetch(`${geminiUrl(GEMINI_MODEL)}?key=${apiKey}`, {
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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      throw new Error(`Gemini API 호출 실패: ${message}`);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini 응답에서 분석 결과를 찾지 못했습니다.");

    const parsed = JSON.parse(text);
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ analyzed: true, result: normalizeAnalysis(parsed) }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

/**
 * recommendations.js
 * 메인 화면 "맞춤 추천" 섹션(로그인 + 담은 가게가 있을 때만 노출).
 * 내가 담은 가게들의 카테고리 중 가장 자주 담은 카테고리를 찾아, 같은 카테고리로
 * 다시 검색해서 보여준다. 이미 담은 가게는 추천에서 제외한다.
 *
 * 검색은 기존 /api/search(카카오 키워드 검색)를 그대로 재사용한다 — 검색 기능
 * 자체(save.js)는 전혀 건드리지 않는다.
 */

import { getCurrentUser, onAuthChange } from "./auth.js";
import { getSavedPlaces } from "./saved-places.js";

const isLocalDev =
  location.hostname === "localhost" || location.hostname === "127.0.0.1";
const API_BASE_URL = isLocalDev ? "http://localhost:8000" : "";

const recoSection = document.getElementById("reco-section");
const recoLabel = document.getElementById("reco-label");
const recoList = document.getElementById("reco-list");

/**
 * 카카오/구글 카테고리 문자열에서 대표 키워드를 뽑는다.
 * 카카오: "음식점 > 한식 > 육류,고기" → 중분류("한식")를 우선한다.
 * 구글: "restaurant, food, point_of_interest" → 첫 항목을 쓴다.
 */
function extractCategoryKeyword(category) {
  if (!category) return "";
  if (category.includes(">")) {
    const parts = category.split(">").map((s) => s.trim()).filter(Boolean);
    return parts[1] || parts[0] || "";
  }
  return category.split(",")[0].trim();
}

/** 담은 가게들 중 가장 자주 등장하는 카테고리 키워드를 찾는다. */
function findFavoriteCategory(savedPlaces) {
  const counts = new Map();
  savedPlaces.forEach((place) => {
    const keyword = extractCategoryKeyword(place.category);
    if (!keyword) return;
    counts.set(keyword, (counts.get(keyword) || 0) + 1);
  });

  let best = "";
  let bestCount = 0;
  counts.forEach((count, keyword) => {
    if (count > bestCount) {
      best = keyword;
      bestCount = count;
    }
  });
  return best;
}

/** 기존 /api/search(카카오 키워드 검색)를 그대로 호출한다. */
async function searchByKeyword(keyword) {
  const params = new URLSearchParams({ query: keyword });
  const res = await fetch(`${API_BASE_URL}/api/search?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error("추천 검색에 실패했습니다.");
  return data.documents || [];
}

function createRecoCard(doc) {
  const card = document.createElement("article");
  card.className = "reco-card";

  const name = document.createElement("h3");
  name.className = "reco-card__name";
  name.textContent = doc.place_name || "이름 없음";
  card.appendChild(name);

  if (doc.category_name) {
    const category = document.createElement("p");
    category.className = "reco-card__category";
    category.textContent = doc.category_name;
    card.appendChild(category);
  }

  const address = document.createElement("p");
  address.className = "reco-card__address";
  address.textContent = doc.road_address_name || doc.address_name || "";
  card.appendChild(address);

  if (doc.place_url) {
    const link = document.createElement("a");
    link.className = "reco-card__link";
    link.href = doc.place_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "카카오맵에서 보기";
    card.appendChild(link);
  }

  return card;
}

async function renderRecommendations() {
  if (!getCurrentUser()) {
    recoSection.hidden = true;
    return;
  }

  const savedPlaces = await getSavedPlaces();
  if (!savedPlaces.length) {
    recoSection.hidden = true;
    return;
  }

  const favoriteCategory = findFavoriteCategory(savedPlaces);
  if (!favoriteCategory) {
    recoSection.hidden = true;
    return;
  }

  const savedPlaceIds = new Set(savedPlaces.map((p) => p.place_id));

  try {
    const results = await searchByKeyword(favoriteCategory);
    const candidates = results
      .filter((doc) => !savedPlaceIds.has(`kakao-${doc.id}`))
      .slice(0, 5);

    if (!candidates.length) {
      recoSection.hidden = true;
      return;
    }

    recoLabel.textContent = `자주 담은 "${favoriteCategory}" 취향으로 골라봤어요`;
    recoList.innerHTML = "";
    const fragment = document.createDocumentFragment();
    candidates.forEach((doc) => fragment.appendChild(createRecoCard(doc)));
    recoList.appendChild(fragment);
    recoSection.hidden = false;
  } catch (err) {
    console.error("[recommendations.js] 추천 검색 실패:", err);
    recoSection.hidden = true;
  }
}

onAuthChange(renderRecommendations);

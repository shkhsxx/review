/**
 * saved-places.js
 * 로그인한 사용자가 "담은" 맛집(Supabase의 public.saved_places 테이블) 관리.
 * 비밀번호와 마찬가지로 접근 제어(RLS)는 전부 Supabase에 맡기고, 이 모듈은
 * 그 위에 얇은 래퍼만 제공한다. 로그인 여부 확인은 auth.js를 그대로 재사용한다.
 *
 * 테이블 스키마 (saved_places.sql 참고):
 *   user_id, place_id(가게 고유번호), place_name, category, address, lat, lng, created_at
 *   unique(user_id, place_id) — 같은 사람이 같은 가게를 두 번 담는 것을 DB 레벨에서 방지.
 */

import { supabase, getCurrentUser, onAuthChange } from "./auth.js";

const TABLE = "saved_places";

/** 로그인하지 않은 상태에서 담기/제거를 시도했을 때 던지는 에러. */
export class LoginRequiredError extends Error {
  constructor() {
    super("로그인하면 담을 수 있어요.");
  }
}

// place_id -> saved_places row. 로그인하지 않았거나 아직 로드 전이면 null.
let cache = null;
let loadPromise = null;

function resetCache() {
  cache = null;
  loadPromise = null;
}

onAuthChange((user) => {
  resetCache();
  if (user) loadSavedPlaces();
});

async function loadSavedPlaces() {
  if (!getCurrentUser()) {
    cache = new Map();
    return cache;
  }
  if (!loadPromise) {
    // 검색 등 기존 기능은 이 조회가 실패해도(예: 테이블이 아직 없음) 절대 막혀서는 안 되므로
    // 에러를 던지지 않고 빈 목록으로 대체한다.
    loadPromise = supabase
      .from(TABLE)
      .select("*")
      .then(({ data, error }) => {
        if (error) {
          console.error("[saved-places.js] 담은 맛집 목록을 불러오지 못했습니다:", error);
          cache = new Map();
          return cache;
        }
        cache = new Map((data || []).map((row) => [row.place_id, row]));
        return cache;
      });
  }
  return loadPromise;
}

/** 담은 가게 목록이 준비될 때까지 기다린다. 검색 결과를 렌더링하기 전에 호출해야
 *  '담김' 상태가 처음부터 정확히 표시된다. */
export async function waitForSavedPlaces() {
  if (cache) return cache;
  return loadSavedPlaces();
}

/** 동기 조회. waitForSavedPlaces()로 캐시가 준비된 뒤에 호출한다. */
export function isPlaceSaved(placeId) {
  return !!(cache && cache.has(placeId));
}

/** 현재 담은 가게 전체 목록(담은 시간 포함)을 반환한다. */
export async function getSavedPlaces() {
  await waitForSavedPlaces();
  return Array.from(cache.values());
}

export async function savePlace(place, placeId) {
  const user = getCurrentUser();
  if (!user) throw new LoginRequiredError();

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      user_id: user.id,
      place_id: placeId,
      place_name: place.place_name || "",
      category: place.category_name || "",
      address: place.road_address_name || place.address_name || "",
      lat: place.y ? Number(place.y) : null,
      lng: place.x ? Number(place.x) : null,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") throw new Error("이미 담은 가게예요.");
    throw new Error(error.message || "담기에 실패했습니다.");
  }

  if (cache) cache.set(placeId, data);
  return data;
}

export async function removePlace(placeId) {
  const user = getCurrentUser();
  if (!user) throw new LoginRequiredError();

  const { error } = await supabase.from(TABLE).delete().eq("place_id", placeId);
  if (error) throw new Error(error.message || "삭제에 실패했습니다.");
  if (cache) cache.delete(placeId);
}

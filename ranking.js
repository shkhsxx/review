/**
 * ranking.js
 * 메인 화면 "인기 맛집 TOP 5" 섹션. 모든 사용자가 담은 횟수를 합산한 결과를
 * Postgres 함수 get_top_saved_places()로 가져온다. 로그인 여부와 무관하게 노출된다.
 *
 * saved_places 테이블은 RLS로 "본인이 담은 것"만 조회 가능하지만, 이 함수는
 * SECURITY DEFINER로 만들어져 전체를 집계할 수 있다. 대신 반환 컬럼을
 * 가게 이름(place_name)과 담긴 횟수(save_count)로만 제한해 누가 담았는지는
 * 절대 노출하지 않는다.
 */

import { supabase } from "./auth.js";

const rankingList = document.getElementById("ranking-list");
const rankingEmpty = document.getElementById("ranking-empty");
const rankingLoading = document.getElementById("ranking-loading");

function createRankingItem(rank, row) {
  const item = document.createElement("li");
  item.className = "rank-item";

  const badge = document.createElement("span");
  badge.className = "rank-item__badge";
  badge.textContent = rank;
  item.appendChild(badge);

  const name = document.createElement("span");
  name.className = "rank-item__name";
  name.textContent = row.place_name;
  item.appendChild(name);

  const count = document.createElement("span");
  count.className = "rank-item__count";
  count.textContent = `${row.save_count}명이 담음`;
  item.appendChild(count);

  return item;
}

async function renderRanking() {
  const { data, error } = await supabase.rpc("get_top_saved_places", { result_limit: 5 });
  rankingLoading.hidden = true;

  if (error) {
    console.error("[ranking.js] 인기 랭킹을 불러오지 못했습니다:", error);
    rankingEmpty.hidden = false;
    return;
  }

  if (!data || !data.length) {
    rankingEmpty.hidden = false;
    return;
  }

  rankingEmpty.hidden = true;
  rankingList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  data.forEach((row, i) => fragment.appendChild(createRankingItem(i + 1, row)));
  rankingList.appendChild(fragment);
}

renderRanking();

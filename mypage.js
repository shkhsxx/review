/**
 * mypage.js
 * "맛집주머니" 페이지 로직. 로그인한 사용자가 담은 맛집(saved_places)을
 * 최근 담은 순으로 카드 형태로 보여주고, 카드별 X 버튼으로 삭제할 수 있다.
 *
 * 데이터는 saved-places.js의 getSavedPlaces()/removePlace()를 그대로 재사용한다.
 * getSavedPlaces()는 "내 것만" 조건을 걸지 않고 테이블 전체를 조회하며,
 * Supabase RLS가 로그인한 사용자 본인의 행만 돌려준다.
 */

import { getCurrentUser, onAuthChange } from "./auth.js";
import { promptLogin } from "./auth-widget.js";
import { getSavedPlaces, savePlace, removePlace } from "./saved-places.js";
import { showUndoToast } from "./toast.js";

const pocketList = document.getElementById("pocket-list");
const pocketEmpty = document.getElementById("pocket-empty");
const pocketEmptyText = document.getElementById("pocket-empty-text");
const pocketEmptyAction = document.getElementById("pocket-empty-action");

/** ISO 타임스탬프를 "YYYY.MM.DD" 형태로 표시한다. */
function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

/** 저장된 좌표로 구글 지도 링크를 만든다. 좌표가 없으면 빈 문자열. */
function buildMapLink(entry) {
  if (typeof entry.lat !== "number" || typeof entry.lng !== "number") return "";
  return `https://www.google.com/maps/search/?api=1&query=${entry.lat},${entry.lng}`;
}

/** 담은 맛집 한 건을 .pocket-card DOM으로 변환 */
function createPocketCard(entry) {
  const card = document.createElement("article");
  card.className = "pocket-card";
  card.dataset.placeId = entry.place_id;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "pocket-card__remove-btn";
  removeBtn.textContent = "✕";
  removeBtn.setAttribute("aria-label", "삭제");
  removeBtn.addEventListener("click", () => handleRemove(entry, card, removeBtn));
  card.appendChild(removeBtn);

  const name = document.createElement("h2");
  name.className = "pocket-card__name";
  name.textContent = entry.place_name || "이름 없음";
  card.appendChild(name);

  if (entry.category) {
    const category = document.createElement("p");
    category.className = "pocket-card__category";
    category.textContent = entry.category;
    card.appendChild(category);
  }

  const address = document.createElement("p");
  address.className = "pocket-card__address";
  address.textContent = entry.address || "";
  card.appendChild(address);

  const date = document.createElement("p");
  date.className = "pocket-card__date";
  date.textContent = formatDate(entry.created_at);
  card.appendChild(date);

  const mapUrl = buildMapLink(entry);
  if (mapUrl) {
    const mapLink = document.createElement("a");
    mapLink.className = "pocket-card__map-link";
    mapLink.href = mapUrl;
    mapLink.target = "_blank";
    mapLink.rel = "noopener noreferrer";
    mapLink.textContent = "구글맵 보기";
    card.appendChild(mapLink);
  }

  return card;
}

/** saved_places 행(entry)을 savePlace()가 기대하는 place 형태로 되돌린다(삭제 되돌리기용). */
function entryToPlace(entry) {
  return {
    place_name: entry.place_name,
    category_name: entry.category,
    address_name: entry.address,
    road_address_name: "",
    x: entry.lng,
    y: entry.lat,
  };
}

/** X 버튼 클릭 시 테이블에서 삭제하고, 성공하면 카드도 목록에서 뺀다(몇 초간 되돌리기 가능). */
async function handleRemove(entry, card, btn) {
  btn.disabled = true;
  try {
    await removePlace(entry.place_id);
    card.remove();
    if (!pocketList.children.length) renderEmptyState();

    showUndoToast("삭제했어요", async () => {
      try {
        await savePlace(entryToPlace(entry), entry.place_id);
        render();
      } catch (err) {
        console.error("[mypage.js] 삭제 되돌리기 실패:", err);
      }
    });
  } catch (err) {
    console.error("[mypage.js] 삭제 실패:", err);
    btn.disabled = false;
  }
}

/** 비로그인 / 빈 목록 상태에 맞는 안내 문구와 버튼을 보여준다. */
function renderEmptyState() {
  pocketList.innerHTML = "";

  if (!getCurrentUser()) {
    pocketEmptyText.textContent = "로그인하면 담은 맛집을 볼 수 있어요.";
    pocketEmptyAction.textContent = "로그인하기";
    pocketEmptyAction.removeAttribute("href");
    pocketEmptyAction.onclick = (event) => {
      event.preventDefault();
      promptLogin("로그인하면 담은 맛집을 볼 수 있어요.");
    };
  } else {
    pocketEmptyText.textContent = "아직 담은 맛집이 없어요. 검색하러 가볼까요?";
    pocketEmptyAction.textContent = "맛집 검색하러 가기";
    pocketEmptyAction.href = "save.html";
    pocketEmptyAction.onclick = null;
  }

  pocketEmpty.hidden = false;
}

async function render() {
  pocketEmpty.hidden = true;
  pocketList.innerHTML = "";

  if (!getCurrentUser()) {
    renderEmptyState();
    return;
  }

  const list = await getSavedPlaces();
  if (!list.length) {
    renderEmptyState();
    return;
  }

  const fragment = document.createDocumentFragment();
  [...list]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .forEach((entry) => fragment.appendChild(createPocketCard(entry)));
  pocketList.appendChild(fragment);
}

onAuthChange(render);

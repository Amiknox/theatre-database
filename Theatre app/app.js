const STORE_KEY = "theatre-database:v1";
const SUPABASE_MODULE_URL = "https://esm.sh/@supabase/supabase-js@2";
const ATTENDEES = ["Andrew", "Tina", "Mac", "Alice", "Jonathan", "Jo", "Oda", "Viv", "Adam"];
const EMPTY_SHOW = {
  play: "",
  dateSeen: "",
  book: "",
  music: "",
  lyrics: "",
  adaptedBy: "",
  director: "",
  theatre: "",
  runStart: "",
  runEnd: "",
  attendees: [],
  notes: "",
  cast: [{ character: "", actor: "" }]
};

let state = {
  shows: [],
  loaded: false,
  online: false,
  supabase: null,
  session: null,
  userRole: "local",
  authMessage: ""
};

const app = document.querySelector("#app");
const castTemplate = document.querySelector("#cast-row-template");

init();

async function init() {
  await initSupabase();
  if (state.online && !state.session) {
    state.loaded = true;
    bindNavigation();
    renderAuth();
    return;
  }
  state.shows = await loadShows();
  state.loaded = true;
  bindNavigation();
  if (!location.hash) {
    navigate("search", true);
  }
  render();
}

function bindNavigation() {
  window.addEventListener("hashchange", render);
  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.route));
  });
}

async function initSupabase() {
  const config = window.THEATRE_CONFIG || {};
  if (!config.supabaseUrl || !config.supabaseAnonKey) return;
  try {
    const { createClient } = await import(SUPABASE_MODULE_URL);
    state.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
    state.online = true;
    const { data } = await state.supabase.auth.getSession();
    state.session = data.session;
    state.userRole = await loadUserRole();
    state.supabase.auth.onAuthStateChange(async (_event, session) => {
      state.session = session;
      state.userRole = await loadUserRole();
      state.shows = session ? await loadShows() : [];
      state.loaded = true;
      render();
    });
  } catch (error) {
    state.authMessage = `Supabase could not start: ${error.message}`;
    state.online = false;
    state.supabase = null;
  }
}

async function loadShows() {
  if (state.online && state.session) {
    return loadRemoteShows();
  }

  const stored = localStorage.getItem(STORE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      return normalizeShows(parsed.shows || []);
    } catch {
      localStorage.removeItem(STORE_KEY);
    }
  }

  try {
    const response = await fetch("data/shows.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Seed data not found");
    const parsed = await response.json();
    const shows = normalizeShows(parsed.shows || []);
    saveShows(shows);
    return shows;
  } catch {
    return [];
  }
}

async function loadRemoteShows() {
  const { data, error } = await state.supabase
    .from("shows")
    .select("*, cast_members(*), show_attendees(attendee)")
    .order("date_seen", { ascending: false });
  if (error) {
    state.authMessage = `Database read failed: ${error.message}`;
    return [];
  }
  return normalizeShows(data.map(remoteToShow));
}

async function loadUserRole() {
  if (!state.supabase) return "local";
  const { data: sessionData } = await state.supabase.auth.getSession();
  if (!sessionData.session) return "";
  const { data, error } = await state.supabase.rpc("current_app_role");
  if (error || !data) return "";
  return data;
}

function normalizeShows(shows) {
  return shows.map((show) => ({
    id: show.id || crypto.randomUUID(),
    play: clean(show.play),
    dateSeen: clean(show.dateSeen),
    book: clean(show.book),
    music: clean(show.music),
    lyrics: clean(show.lyrics),
    adaptedBy: clean(show.adaptedBy),
    director: clean(show.director),
    theatre: clean(show.theatre),
    runStart: clean(show.runStart),
    runEnd: clean(show.runEnd),
    attendees: Array.isArray(show.attendees) ? show.attendees.filter(Boolean) : [],
    notes: clean(show.notes),
    cast: normalizeCast(show.cast)
  })).sort(sortShows);
}

function normalizeCast(cast) {
  const rows = Array.isArray(cast) ? cast : [];
  const cleaned = rows
    .map((row) => ({ character: clean(row.character), actor: clean(row.actor) }))
    .filter((row) => row.character || row.actor);
  return cleaned.length ? cleaned : [];
}

function saveShows(shows = state.shows) {
  state.shows = normalizeShows(shows);
  localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, shows: state.shows }, null, 2));
}

async function saveShow(show) {
  try {
    if (!state.online) {
      const existing = state.shows.some((item) => item.id === show.id);
      saveShows(existing
        ? state.shows.map((item) => item.id === show.id ? show : item)
        : [...state.shows, show]);
      return { ok: true };
    }

    if (!canEdit()) return { ok: false, message: "This account can view entries but cannot edit them." };
    const payload = showToRemote(show);
    const { error: showError } = await state.supabase.from("shows").upsert(payload.show);
    if (showError) return { ok: false, message: showError.message };

    const { error: castDeleteError } = await state.supabase.from("cast_members").delete().eq("show_id", show.id);
    if (castDeleteError) return { ok: false, message: castDeleteError.message };

    const { error: attendeeDeleteError } = await state.supabase.from("show_attendees").delete().eq("show_id", show.id);
    if (attendeeDeleteError) return { ok: false, message: attendeeDeleteError.message };

    if (payload.cast.length) {
      const { error } = await state.supabase.from("cast_members").insert(payload.cast);
      if (error) return { ok: false, message: error.message };
    }
    if (payload.attendees.length) {
      const { error } = await state.supabase.from("show_attendees").insert(payload.attendees);
      if (error) return { ok: false, message: error.message };
    }

    state.shows = await loadShows();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message || "Save failed." };
  }
}

async function deleteShow(id) {
  if (!state.online) {
    saveShows(state.shows.filter((item) => item.id !== id));
    return { ok: true };
  }
  if (!canEdit()) return { ok: false, message: "This account can view entries but cannot delete them." };
  const { error } = await state.supabase.from("shows").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  state.shows = await loadShows();
  return { ok: true };
}

function remoteToShow(row) {
  return {
    id: row.id,
    play: row.play,
    dateSeen: row.date_seen,
    book: row.book,
    music: row.music,
    lyrics: row.lyrics,
    adaptedBy: row.adapted_by,
    director: row.director,
    theatre: row.theatre,
    runStart: row.run_start,
    runEnd: row.run_end,
    attendees: (row.show_attendees || []).map((item) => item.attendee),
    notes: row.notes,
    cast: (row.cast_members || [])
      .sort((a, b) => a.billing_order - b.billing_order)
      .map((item) => ({ character: item.character, actor: item.actor }))
  };
}

function showToRemote(show) {
  return {
    show: {
      id: show.id,
      play: show.play,
      date_seen: show.dateSeen || null,
      book: show.book || null,
      music: show.music || null,
      lyrics: show.lyrics || null,
      adapted_by: show.adaptedBy || null,
      director: show.director || null,
      theatre: show.theatre || null,
      run_start: show.runStart || null,
      run_end: show.runEnd || null,
      notes: show.notes || null
    },
    cast: show.cast.map((row, index) => ({
      show_id: show.id,
      billing_order: index + 1,
      character: row.character || null,
      actor: row.actor || null
    })),
    attendees: show.attendees.map((attendee) => ({ show_id: show.id, attendee }))
  };
}

function navigate(route, replace = false) {
  const nextHash = `#/${route}`;
  if (replace) {
    history.replaceState(null, "", nextHash);
    render();
  } else {
    location.hash = nextHash;
  }
}

function getRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [name = "search", ...rest] = hash.split("/");
  return { name, id: decodeURIComponent(rest.join("/")) };
}

function render() {
  if (!state.loaded) return;
  if (state.online && !state.session) {
    renderAuth();
    return;
  }
  const route = getRoute();
  document.querySelectorAll("[data-route]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.route === topLevelRoute(route.name));
  });

  if (route.name === "show") return renderShow(route.id);
  if (route.name === "actor") return renderActor(route.id);
  if (route.name === "entity") return renderEntity(route.id);
  if (route.name === "add") return renderForm();
  if (route.name === "edit") return renderForm(route.id);
  if (route.name === "actors") return renderActors();
  if (route.name === "tools") return renderTools();
  renderSearch();
}

function renderAuth() {
  document.querySelectorAll("[data-route]").forEach((button) => button.classList.remove("is-active"));
  app.innerHTML = `
    <section class="panel auth-panel">
      <h2>Sign In</h2>
      <p class="small">Access is limited to invited accounts. Enter your email address and Supabase will send you a sign-in link.</p>
      <form id="auth-form" class="form-grid">
        <label class="wide">
          <span>Email</span>
          <input name="email" type="email" autocomplete="email" required placeholder="name@example.com">
        </label>
        <div class="form-actions">
          <button class="button" type="submit">Send Sign-In Link</button>
          <span id="auth-status" class="status">${escapeHtml(state.authMessage)}</span>
        </div>
      </form>
    </section>
  `;
  app.querySelector("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = clean(new FormData(event.currentTarget).get("email")).toLowerCase();
    const status = app.querySelector("#auth-status");
    status.textContent = "Sending sign-in link...";
    const { error } = await state.supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname }
    });
    status.textContent = error ? error.message : "Check your email for the sign-in link.";
  });
}

function renderAccountBar() {
  if (!state.online || !state.session) return "";
  const email = state.session.user?.email || "";
  const role = state.userRole || "no access";
  return `
    <div class="account-bar">
      <span>${escapeHtml(email)}</span>
      <span class="pill">${escapeHtml(role)}</span>
      <span class="pill">${escapeHtml(dataSourceLabel())}</span>
      <button class="ghost-button" id="sign-out" type="button">Sign Out</button>
    </div>
  `;
}

function bindAccountBar() {
  const button = app.querySelector("#sign-out");
  if (!button) return;
  button.addEventListener("click", async () => {
    await state.supabase.auth.signOut();
  });
}

function canEdit() {
  return !state.online || ["editor", "admin"].includes(state.userRole);
}

function dataSourceLabel() {
  if (state.online && state.session) return "Supabase";
  if (state.online) return "Sign-in required";
  return "Local fallback";
}

function loadedCastCount() {
  return state.shows.reduce((total, show) => total + show.cast.length, 0);
}

function loadedAttendeeCount() {
  return state.shows.reduce((total, show) => total + show.attendees.length, 0);
}

function topLevelRoute(name) {
  if (name === "show") return "search";
  if (name === "entity") return "search";
  if (name === "actor") return "actors";
  if (name === "edit") return "add";
  return name;
}

function renderSearch() {
  app.innerHTML = `
    ${renderAccountBar()}
    <section>
      <div class="toolbar">
        <label>
          <span>Search all fields</span>
          <input id="query" class="search-input" type="search" placeholder="Play, actor, character, theatre, director, attendee...">
        </label>
        <label>
          <span>Field</span>
          <select id="field-filter">
            <option value="all">All fields</option>
            <option value="play">Play</option>
            <option value="cast">Cast</option>
            <option value="actor">Actor</option>
            <option value="character">Character</option>
            <option value="dateSeen">Date seen</option>
            <option value="book">Book</option>
            <option value="music">Music</option>
            <option value="lyrics">Lyrics</option>
            <option value="adaptedBy">Adapted by</option>
            <option value="director">Director</option>
            <option value="theatre">Theatre</option>
            <option value="run">Run</option>
            <option value="attendees">Attendees</option>
            <option value="notes">Notes</option>
          </select>
        </label>
        <label>
          <span>Attendee</span>
          <select id="attendee-filter">
            <option value="">Anyone</option>
            ${ATTENDEES.map((name) => `<option>${escapeHtml(name)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div id="result-count" class="status"></div>
      <div id="results" class="result-grid"></div>
    </section>
  `;
  bindAccountBar();

  const query = app.querySelector("#query");
  const field = app.querySelector("#field-filter");
  const attendee = app.querySelector("#attendee-filter");
  const update = () => drawSearchResults(query.value, field.value, attendee.value);
  query.addEventListener("input", update);
  field.addEventListener("change", update);
  attendee.addEventListener("change", update);
  update();
  query.focus();
}

function drawSearchResults(query, field, attendee) {
  const entities = matchingEntities(query, field, attendee);
  if (entities) {
    drawEntityResults(entities);
    return;
  }
  drawResults(filterShows(query, field, attendee));
}

function drawResults(shows) {
  app.querySelector("#result-count").textContent = `${shows.length} ${shows.length === 1 ? "entry" : "entries"}`;
  const results = app.querySelector("#results");
  if (!shows.length) {
    results.innerHTML = `<div class="empty-state">No matching entries yet.</div>`;
    return;
  }
  results.innerHTML = shows.map((show) => `
    <article class="result-card">
      <button type="button" data-show="${show.id}">${escapeHtml(show.play || "Untitled play")}</button>
      <p class="meta">${compact([formatDate(show.dateSeen), show.theatre, show.director]).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</p>
      <p>${escapeHtml(firstFilled(show.notes, show.book, show.adaptedBy, "No notes recorded."))}</p>
      <div class="meta">${show.attendees.map((name) => `<span class="pill">${escapeHtml(name)}</span>`).join("")}</div>
    </article>
  `).join("");
  results.querySelectorAll("[data-show]").forEach((button) => {
    button.addEventListener("click", () => navigate(`show/${encodeURIComponent(button.dataset.show)}`));
  });
}

function drawEntityResults(entities) {
  app.querySelector("#result-count").textContent = `${entities.length} ${entities.length === 1 ? "result" : "results"}`;
  const results = app.querySelector("#results");
  if (!entities.length) {
    results.innerHTML = `<div class="empty-state">No matching results yet.</div>`;
    return;
  }
  results.innerHTML = renderEntityCards(entities);
  bindEntityCards(results);
}

function matchingEntities(query, field, attendee) {
  const needle = query.trim().toLowerCase();
  const entityFields = entitySearchFields(field);
  if (!entityFields.length) return null;
  const shows = attendee ? state.shows.filter((show) => show.attendees.includes(attendee)) : state.shows;
  const entities = entityIndex(shows, entityFields)
    .filter((entity) => !needle || entity.name.toLowerCase().includes(needle));
  if (field !== "all") return entities;
  if (!needle) return null;
  return entities.length ? entities : null;
}

function entitySearchFields(field) {
  if (field === "all") {
    return ["actor", "character", "dateSeen", "book", "music", "lyrics", "adaptedBy", "director", "theatre", "run", "attendees", "notes"];
  }
  if (field === "cast") return ["actor", "character"];
  if (field === "play") return [];
  return [field];
}

function filterShows(query, field, attendee) {
  const needle = query.trim().toLowerCase();
  return state.shows.filter((show) => {
    if (attendee && !show.attendees.includes(attendee)) return false;
    if (!needle) return true;
    return searchableValues(show, field).some((value) => value.toLowerCase().includes(needle));
  });
}

function searchableValues(show, field = "all") {
  const values = {
    play: [show.play],
    dateSeen: [formatDate(show.dateSeen), show.dateSeen],
    book: [show.book],
    music: [show.music],
    lyrics: [show.lyrics],
    adaptedBy: [show.adaptedBy],
    director: [show.director],
    theatre: [show.theatre],
    run: [formatRun(show)],
    attendees: show.attendees,
    notes: [show.notes],
    actor: show.cast.map((row) => row.actor),
    character: show.cast.map((row) => row.character),
    cast: show.cast.flatMap((row) => [row.character, row.actor])
  };
  if (field !== "all") return values[field] || [];
  return Object.values(values).flat();
}

function renderShow(id) {
  const show = state.shows.find((item) => item.id === id);
  if (!show) {
    app.innerHTML = `<div class="empty-state">Entry not found.</div>`;
    return;
  }

  app.innerHTML = `
    ${renderAccountBar()}
    <section class="detail-layout">
      <article class="panel">
        <button class="link-button" id="back" type="button">Back to search</button>
        <h2>${escapeHtml(show.play || "Untitled play")}</h2>
        <dl class="detail-list">
          ${detailRow("Date seen", formatDate(show.dateSeen))}
          ${detailRow("Book", show.book)}
          ${detailRow("Music", show.music)}
          ${detailRow("Lyrics", show.lyrics)}
          ${detailRow("Adapted by", show.adaptedBy)}
          ${detailRow("Director", show.director)}
          ${detailRow("Theatre", show.theatre)}
          ${detailRow("Run", formatRun(show))}
          ${detailRow("Attendees", show.attendees.join(", "))}
          ${detailRow("Notes", show.notes)}
        </dl>
        <div class="form-actions">
          ${canEdit() ? `<button class="button" id="edit" type="button">Edit entry</button>
          <button class="danger-button" id="delete" type="button">Delete entry</button>` : `<span class="status">Signed in with view-only access.</span>`}
        </div>
      </article>
      <aside class="panel">
        <h3>Cast</h3>
        ${renderCastTable(show.cast)}
      </aside>
    </section>
  `;

  bindAccountBar();
  app.querySelector("#back").addEventListener("click", () => navigate("search"));
  app.querySelector("#edit")?.addEventListener("click", () => navigate(`edit/${encodeURIComponent(show.id)}`));
  app.querySelector("#delete")?.addEventListener("click", async () => {
    if (!confirm(`Delete "${show.play}"?`)) return;
    const result = await deleteShow(show.id);
    if (!result.ok) {
      alert(result.message);
      return;
    }
    navigate("search");
  });
  app.querySelectorAll("[data-actor]").forEach((button) => {
    button.addEventListener("click", () => navigate(`actor/${encodeURIComponent(button.dataset.actor)}`));
  });
}

function renderCastTable(cast) {
  if (!cast.length) return `<p class="small">No cast recorded.</p>`;
  return `
    <table class="cast-table">
      <thead><tr><th>Character</th><th>Actor</th></tr></thead>
      <tbody>
        ${cast.map((row) => `
          <tr>
            <td>${escapeHtml(row.character || "")}</td>
            <td>${row.actor ? `<button class="link-button" type="button" data-actor="${escapeAttr(row.actor)}">${escapeHtml(row.actor)}</button>` : ""}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderForm(id = "") {
  if (!canEdit()) {
    app.innerHTML = `${renderAccountBar()}<div class="empty-state">This account can view entries but cannot edit them.</div>`;
    bindAccountBar();
    return;
  }
  const existing = state.shows.find((item) => item.id === id);
  const show = structuredClone(existing || EMPTY_SHOW);
  const title = existing ? "Edit Entry" : "Add Entry";

  app.innerHTML = `
    ${renderAccountBar()}
    <section class="panel">
      <h2>${title}</h2>
      <form id="entry-form" class="form-grid">
        ${inputField("play", "Play", show.play, "text", true)}
        ${inputField("dateSeen", "Date seen", show.dateSeen, "date")}
        ${inputField("book", "Book", show.book)}
        ${inputField("music", "Music", show.music)}
        ${inputField("lyrics", "Lyrics", show.lyrics)}
        ${inputField("adaptedBy", "Adapted by", show.adaptedBy)}
        ${inputField("director", "Director", show.director)}
        ${inputField("theatre", "Theatre", show.theatre)}
        ${inputField("runStart", "Run start", show.runStart, "date")}
        ${inputField("runEnd", "Run end", show.runEnd, "date")}
        <div class="wide">
          <span class="field-label">Attendees</span>
          <div class="attendee-list">
            ${ATTENDEES.map((name) => `
              <label><input type="checkbox" name="attendees" value="${escapeAttr(name)}" ${show.attendees.includes(name) ? "checked" : ""}>${escapeHtml(name)}</label>
            `).join("")}
          </div>
        </div>
        <label class="wide">
          <span>Notes</span>
          <textarea name="notes">${escapeHtml(show.notes)}</textarea>
        </label>
        <div class="cast-editor">
          <div>
            <span class="field-label">Cast</span>
            <div id="cast-rows"></div>
          </div>
          <button class="ghost-button" id="add-cast-row" type="button">Add Cast Pair</button>
        </div>
        <div class="form-actions">
          <button class="button" id="save-entry" type="submit">${existing ? "Save Changes" : "Add Entry"}</button>
          <button class="ghost-button" id="cancel" type="button">Cancel</button>
          <span id="form-status" class="status"></span>
        </div>
      </form>
    </section>
  `;

  bindAccountBar();
  const castRows = app.querySelector("#cast-rows");
  (show.cast.length ? show.cast : [{ character: "", actor: "" }]).forEach((row) => addCastRow(castRows, row));
  app.querySelector("#add-cast-row").addEventListener("click", () => addCastRow(castRows));
  app.querySelector("#cancel").addEventListener("click", () => existing ? navigate(`show/${encodeURIComponent(existing.id)}`) : navigate("search"));
  app.querySelector("#entry-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = app.querySelector("#form-status");
    const saveButton = app.querySelector("#save-entry");
    status.textContent = "";
    if (!form.reportValidity()) return;
    const saved = readShowForm(event.currentTarget, existing?.id);
    if (!saved.play) {
      status.textContent = "Play is required.";
      return;
    }
    saveButton.disabled = true;
    status.textContent = "Saving...";
    const result = await saveShow(saved);
    saveButton.disabled = false;
    if (!result.ok) {
      status.textContent = result.message;
      return;
    }
    status.textContent = "Saved.";
    navigate(`show/${encodeURIComponent(saved.id)}`);
  });
}

function addCastRow(container, row = { character: "", actor: "" }) {
  const clone = castTemplate.content.firstElementChild.cloneNode(true);
  clone.querySelector('[name="character"]').value = row.character || "";
  clone.querySelector('[name="actor"]').value = row.actor || "";
  clone.querySelector(".remove-cast").addEventListener("click", () => {
    if (container.children.length === 1) {
      clone.querySelector('[name="character"]').value = "";
      clone.querySelector('[name="actor"]').value = "";
      return;
    }
    clone.remove();
  });
  container.append(clone);
}

function readShowForm(form, id) {
  const data = new FormData(form);
  const cast = Array.from(form.querySelectorAll(".cast-edit-row")).map((row) => ({
    character: clean(row.querySelector('[name="character"]').value),
    actor: clean(row.querySelector('[name="actor"]').value)
  })).filter((row) => row.character || row.actor);

  return {
    id: id || crypto.randomUUID(),
    play: clean(data.get("play")),
    dateSeen: clean(data.get("dateSeen")),
    book: clean(data.get("book")),
    music: clean(data.get("music")),
    lyrics: clean(data.get("lyrics")),
    adaptedBy: clean(data.get("adaptedBy")),
    director: clean(data.get("director")),
    theatre: clean(data.get("theatre")),
    runStart: clean(data.get("runStart")),
    runEnd: clean(data.get("runEnd")),
    attendees: data.getAll("attendees").map(clean),
    notes: clean(data.get("notes")),
    cast
  };
}

function renderActors() {
  const actors = entityIndex(state.shows, ["actor"]);
  app.innerHTML = `
    ${renderAccountBar()}
    <section>
      <div class="toolbar">
        <label>
          <span>Search actors</span>
          <input id="actor-query" class="search-input" type="search" placeholder="Actor name">
        </label>
      </div>
      <div id="actors" class="actor-grid"></div>
    </section>
  `;
  bindAccountBar();
  const query = app.querySelector("#actor-query");
  const draw = () => {
    const needle = query.value.trim().toLowerCase();
    const filtered = actors.filter((actor) => actor.name.toLowerCase().includes(needle));
    const target = app.querySelector("#actors");
    target.innerHTML = filtered.length ? renderEntityCards(filtered) : `<div class="empty-state">No actors found.</div>`;
    bindEntityCards(target);
  };
  query.addEventListener("input", draw);
  draw();
}

function renderActor(name) {
  const decoded = name;
  const credits = [];
  state.shows.forEach((show) => {
    show.cast.filter((row) => sameName(row.actor, decoded)).forEach((row) => {
      credits.push({ show, character: row.character });
    });
  });

  app.innerHTML = `
    ${renderAccountBar()}
    <section class="panel">
      <button class="link-button" id="back" type="button">Back to actors</button>
      <h2>${escapeHtml(decoded)}</h2>
      <div class="result-grid">
        ${credits.length ? credits.map(({ show, character }) => `
          <article class="result-card">
            <button type="button" data-show="${show.id}">${escapeHtml(show.play || "Untitled play")}</button>
            <p class="meta">${compact([character, formatDate(show.dateSeen), show.theatre]).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</p>
          </article>
        `).join("") : `<div class="empty-state">No credits recorded.</div>`}
      </div>
    </section>
  `;
  bindAccountBar();
  app.querySelector("#back").addEventListener("click", () => navigate("actors"));
  app.querySelectorAll("[data-show]").forEach((button) => {
    button.addEventListener("click", () => navigate(`show/${encodeURIComponent(button.dataset.show)}`));
  });
}

function renderEntity(encoded) {
  const { field, value } = parseEntityRoute(encoded);
  const definition = entityDefinition(field);
  const entity = entityIndex(state.shows, [field]).find((item) => sameName(item.name, value));
  const credits = entity?.credits || [];

  app.innerHTML = `
    ${renderAccountBar()}
    <section class="panel">
      <button class="link-button" id="back" type="button">Back to search</button>
      <p class="eyebrow">${escapeHtml(definition.label)}</p>
      <h2>${escapeHtml(value || "Untitled")}</h2>
      <div class="result-grid">
        ${credits.length ? credits.map((credit) => `
          <article class="result-card">
            <button type="button" data-show="${credit.show.id}">${escapeHtml(credit.show.play || "Untitled play")}</button>
            <p class="meta">${compact([credit.detail, formatDate(credit.show.dateSeen), credit.show.theatre]).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</p>
          </article>
        `).join("") : `<div class="empty-state">No matching entries recorded.</div>`}
      </div>
    </section>
  `;
  bindAccountBar();
  app.querySelector("#back").addEventListener("click", () => navigate("search"));
  app.querySelectorAll("[data-show]").forEach((button) => {
    button.addEventListener("click", () => navigate(`show/${encodeURIComponent(button.dataset.show)}`));
  });
}

function renderEntityCards(entities) {
  return entities.map((entity) => `
    <article class="entity-card">
      <button type="button" ${entity.field === "actor"
        ? `data-actor="${escapeAttr(entity.name)}"`
        : `data-entity="${escapeAttr(entityRoute(entity.field, entity.name))}"`}>
        ${escapeHtml(entity.name)}
      </button>
      <p class="meta">
        <span>${escapeHtml(entity.label)}</span>
        <span>${entity.credits.length} ${entity.credits.length === 1 ? "entry" : "entries"}</span>
      </p>
      <p>${escapeHtml(entity.credits.slice(0, 3).map((credit) => credit.play).join(", "))}</p>
    </article>
  `).join("");
}

function bindEntityCards(container) {
  container.querySelectorAll("[data-actor]").forEach((button) => {
    button.addEventListener("click", () => navigate(`actor/${encodeURIComponent(button.dataset.actor)}`));
  });
  container.querySelectorAll("[data-entity]").forEach((button) => {
    button.addEventListener("click", () => navigate(`entity/${button.dataset.entity}`));
  });
}

function actorIndex(shows = state.shows) {
  return entityIndex(shows, ["actor"]).map((entity) => ({
    name: entity.name,
    credits: entity.credits.map((credit) => ({
      play: credit.play,
      character: credit.detail,
      showId: credit.show.id
    }))
  }));
}

function entityIndex(shows = state.shows, fields = entitySearchFields("all")) {
  const map = new Map();
  shows.forEach((show) => {
    fields.forEach((field) => {
      entityValues(show, field).forEach(({ value, detail }) => {
        if (!value) return;
        const key = `${field}:${normalizeName(value)}`;
        if (!map.has(key)) map.set(key, {
          field,
          label: entityDefinition(field).label,
          name: value,
          credits: []
        });
        map.get(key).credits.push({ show, play: show.play, detail });
      });
    });
  });
  return [...map.values()].sort((a, b) => {
    const labelCompare = a.label.localeCompare(b.label);
    if (labelCompare) return labelCompare;
    return a.name.localeCompare(b.name);
  });
}

function entityValues(show, field) {
  const definitions = {
    actor: () => show.cast.map((row) => ({ value: row.actor, detail: row.character })),
    character: () => show.cast.map((row) => ({ value: row.character, detail: row.actor })),
    dateSeen: () => [{ value: formatDate(show.dateSeen) || show.dateSeen, detail: show.theatre }],
    book: () => [{ value: show.book, detail: show.play }],
    music: () => [{ value: show.music, detail: show.play }],
    lyrics: () => [{ value: show.lyrics, detail: show.play }],
    adaptedBy: () => [{ value: show.adaptedBy, detail: show.play }],
    director: () => [{ value: show.director, detail: show.theatre }],
    theatre: () => [{ value: show.theatre, detail: formatDate(show.dateSeen) }],
    run: () => [{ value: formatRun(show), detail: show.theatre }],
    attendees: () => show.attendees.map((name) => ({ value: name, detail: formatDate(show.dateSeen) })),
    notes: () => [{ value: show.notes, detail: show.play }]
  };
  return definitions[field]?.().filter((item) => clean(item.value)) || [];
}

function entityDefinition(field) {
  return {
    actor: { label: "Actor" },
    character: { label: "Character" },
    dateSeen: { label: "Date seen" },
    book: { label: "Book" },
    music: { label: "Music" },
    lyrics: { label: "Lyrics" },
    adaptedBy: { label: "Adapted by" },
    director: { label: "Director" },
    theatre: { label: "Theatre" },
    run: { label: "Run" },
    attendees: { label: "Attendee" },
    notes: { label: "Notes" }
  }[field] || { label: "Result" };
}

function entityRoute(field, value) {
  return `${encodeURIComponent(field)}/${encodeURIComponent(value)}`;
}

function parseEntityRoute(encoded) {
  const [field = "", ...rest] = encoded.split("/");
  return {
    field,
    value: rest.join("/")
  };
}

function renderTools() {
  app.innerHTML = `
    ${renderAccountBar()}
    <section class="split">
      <article class="panel">
        <h2>Database Status</h2>
        <dl class="status-list">
          <div>
            <dt>Data source</dt>
            <dd>${escapeHtml(dataSourceLabel())}</dd>
          </div>
          <div>
            <dt>Entries loaded</dt>
            <dd>${state.shows.length}</dd>
          </div>
          <div>
            <dt>Cast rows loaded</dt>
            <dd>${loadedCastCount()}</dd>
          </div>
          <div>
            <dt>Attendee links loaded</dt>
            <dd>${loadedAttendeeCount()}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>${escapeHtml(state.userRole || "not signed in")}</dd>
          </div>
        </dl>
        ${state.online && state.session
          ? `<p class="small">Changes are saved to the shared Supabase database.</p>`
          : `<p class="small warning-text">Changes are not currently using the shared Supabase database.</p>`}
      </article>
      <article class="panel">
        <h2>Data Tools</h2>
        <p class="small">${state.online ? "The shared database is stored in Supabase. Export JSON before bulk edits or migrations." : "The browser database is saved locally on this machine. Export JSON before major edits or before moving to a backend."}</p>
        <div class="tool-actions">
          <button class="button" id="export-json" type="button">Export JSON</button>
          <label class="ghost-button" for="import-json">Import JSON</label>
          <input id="import-json" type="file" accept="application/json" hidden>
          <button class="danger-button" id="reset-data" type="button">Reset Local Data</button>
        </div>
        <p id="tool-status" class="status"></p>
      </article>
      <article class="panel">
        <h2>Add From Theatre Page</h2>
        <p class="small">Automatic scraping is feasible as a semi-assisted workflow. Theatre sites differ and often block browser fetching, so review the parsed draft before saving.</p>
        <label>
          <span>Page URL</span>
          <input id="scrape-url" type="url" placeholder="https://www.nationaltheatre.org.uk/productions/inter-alia/">
        </label>
        <div class="form-actions">
          <button class="ghost-button" id="fetch-page" type="button">Fetch Page</button>
          <button class="ghost-button" id="parse-page" type="button">Parse Draft</button>
        </div>
        <label>
          <span>Paste page text or HTML</span>
          <textarea id="page-source" class="scrape-preview" placeholder="Paste the theatre page text or HTML here if direct fetching is blocked."></textarea>
        </label>
      </article>
    </section>
  `;

  bindAccountBar();
  app.querySelector("#export-json").addEventListener("click", exportJson);
  app.querySelector("#import-json").addEventListener("change", importJson);
  app.querySelector("#reset-data").addEventListener("click", resetData);
  app.querySelector("#fetch-page").addEventListener("click", fetchPage);
  app.querySelector("#parse-page").addEventListener("click", parsePageDraft);
}

function exportJson() {
  const blob = new Blob([JSON.stringify({ version: 1, shows: state.shows }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `theatre-database-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  app.querySelector("#tool-status").textContent = "Exported current database.";
}

async function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  const parsed = JSON.parse(await file.text());
  if (state.online) {
    if (!canEdit()) {
      app.querySelector("#tool-status").textContent = "This account cannot import data.";
      return;
    }
    for (const show of normalizeShows(parsed.shows || [])) {
      const result = await saveShow(show);
      if (!result.ok) {
        app.querySelector("#tool-status").textContent = `Import stopped: ${result.message}`;
        return;
      }
    }
    state.shows = await loadShows();
    app.querySelector("#tool-status").textContent = `Imported ${parsed.shows?.length || 0} entries into Supabase.`;
    return;
  }
  saveShows(parsed.shows || []);
  app.querySelector("#tool-status").textContent = `Imported ${state.shows.length} entries.`;
}

async function resetData() {
  if (state.online) {
    state.shows = await loadShows();
    renderTools();
    return;
  }
  if (!confirm("Reset the local browser database and reload seed data?")) return;
  localStorage.removeItem(STORE_KEY);
  state.shows = await loadShows();
  renderTools();
}

async function fetchPage() {
  const status = app.querySelector("#tool-status");
  const url = app.querySelector("#scrape-url").value.trim();
  if (!url) {
    status.textContent = "Enter a URL first.";
    return;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    app.querySelector("#page-source").value = await response.text();
    status.textContent = "Fetched page. Review the text, then parse a draft.";
  } catch (error) {
    status.textContent = `Direct fetch failed: ${error.message}. Paste the page text or HTML instead.`;
  }
}

function parsePageDraft() {
  const source = app.querySelector("#page-source").value;
  const url = app.querySelector("#scrape-url").value.trim();
  const draft = scrapeDraft(source, url);
  sessionStorage.setItem("theatre-draft", JSON.stringify(draft));
  renderForm();
  const saved = JSON.parse(sessionStorage.getItem("theatre-draft") || "{}");
  fillDraft(saved);
  sessionStorage.removeItem("theatre-draft");
}

function scrapeDraft(source, url) {
  const text = htmlToText(source);
  const title = text.split("\n").map(clean).find(Boolean) || titleFromUrl(url);
  return {
    ...EMPTY_SHOW,
    id: crypto.randomUUID(),
    play: title,
    theatre: theatreFromUrl(url),
    director: extractAfter(text, /director|directed by/i),
    book: extractAfter(text, /book by|writer|written by|by/i),
    music: extractAfter(text, /music by/i),
    lyrics: extractAfter(text, /lyrics by/i),
    adaptedBy: extractAfter(text, /adapted by/i),
    cast: extractCastGuess(text)
  };
}

function fillDraft(draft) {
  const form = app.querySelector("#entry-form");
  if (!form) return;
  Object.entries(draft).forEach(([key, value]) => {
    const input = form.elements[key];
    if (input && typeof value === "string") input.value = value;
  });
  const castRows = app.querySelector("#cast-rows");
  castRows.innerHTML = "";
  (draft.cast?.length ? draft.cast : [{ character: "", actor: "" }]).forEach((row) => addCastRow(castRows, row));
  app.querySelector("#form-status").textContent = "Draft parsed. Please review before saving.";
}

function inputField(name, label, value = "", type = "text", required = false) {
  return `
    <label>
      <span>${label}</span>
      <input name="${name}" type="${type}" value="${escapeAttr(value)}" ${required ? "required" : ""}>
    </label>
  `;
}

function detailRow(label, value) {
  return value ? `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>` : "";
}

function sortShows(a, b) {
  const dateCompare = (b.dateSeen || "").localeCompare(a.dateSeen || "");
  if (dateCompare) return dateCompare;
  return (a.play || "").localeCompare(b.play || "");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatRun(show) {
  if (!show.runStart && !show.runEnd) return "";
  return compact([formatDate(show.runStart), formatDate(show.runEnd)]).join(" to ");
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compact(values) {
  return values.filter((value) => clean(value));
}

function firstFilled(...values) {
  return values.find((value) => clean(value)) || "";
}

function normalizeName(value) {
  return clean(value).toLowerCase();
}

function sameName(a, b) {
  return normalizeName(a) === normalizeName(b);
}

function escapeHtml(value) {
  return clean(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function htmlToText(source) {
  const doc = new DOMParser().parseFromString(source || "", "text/html");
  const text = doc.body?.innerText || source || "";
  return text.replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function extractAfter(text, labelPattern) {
  const lines = text.split("\n").map(clean).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    if (labelPattern.test(lines[index])) {
      const inline = lines[index].split(/:|-|by/i).slice(1).join(" ").trim();
      return inline || lines[index + 1] || "";
    }
  }
  return "";
}

function extractCastGuess(text) {
  const lines = text.split("\n").map(clean).filter(Boolean);
  const castIndex = lines.findIndex((line) => /^cast$/i.test(line) || /cast includes/i.test(line));
  if (castIndex === -1) return [];
  const rows = [];
  for (const line of lines.slice(castIndex + 1, castIndex + 40)) {
    if (/creative|production|booking|tickets|access/i.test(line)) break;
    const parts = line.split(/\s+as\s+| - |: /i).map(clean);
    if (parts.length >= 2) {
      rows.push({ actor: parts[0], character: parts.slice(1).join(" ") });
    }
  }
  return rows.slice(0, 20);
}

function theatreFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("nationaltheatre")) return "National Theatre";
    if (host.includes("donmarwarehouse")) return "Donmar Warehouse";
    if (host.includes("bridgetheatre")) return "Bridge Theatre";
    return host.split(".")[0].replace(/-/g, " ");
  } catch {
    return "";
  }
}

function titleFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return (parts.at(-1) || "").replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  } catch {
    return "";
  }
}

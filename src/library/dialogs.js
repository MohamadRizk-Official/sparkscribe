// Small dialogs shared by My Library and the recording page: rename, confirm, folder picker, toast.
// Built on <dialog>, so focus handling, Esc and the backdrop come from the browser. On phones they open
// as bottom sheets (CSS).
import { esc } from '../lib/account.js';
import { listFolders, createFolder, addToFolder, removeFromFolder } from '../lib/library.js';

// Returns { dlg, dismiss }. dismiss() closes the dialog, runs onClose exactly once and removes it. Cancel
// buttons, Esc and a click on the backdrop all go through it, so nothing depends on the asynchronous
// 'close' event (which a background tab may deliver late).
export function makeDialog(className, html, onClose) {
  const dlg = document.createElement('dialog');
  dlg.className = `confirm sheet ${className}`;
  dlg.innerHTML = html;
  document.body.appendChild(dlg);
  let closed = false;
  const dismiss = () => {
    if (closed) return;
    closed = true;
    if (dlg.open) dlg.close();
    onClose?.();
    setTimeout(() => dlg.remove(), 200);
  };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); dismiss(); }); // Esc
  dlg.addEventListener('close', dismiss);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dismiss(); }); // backdrop
  dlg.showModal();
  return { dlg, dismiss };
}

// -> the new text, or null when cancelled. `validate(value)` may return an error message.
export function promptDialog({ title, label, value = '', confirmLabel = 'Save', maxLength = 300, placeholder = '', submit }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const { dlg, dismiss } = makeDialog('prompt-dlg', `
      <form method="dialog" class="dlg-form">
        <h3>${esc(title)}</h3>
        <label class="dlg-field"><span>${esc(label)}</span>
          <input type="text" maxlength="${maxLength}" value="${esc(value)}" placeholder="${esc(placeholder)}" required autocomplete="off" />
        </label>
        <p class="dlg-err" role="alert" hidden></p>
        <div class="confirm-actions">
          <button class="btn btn-ghost" type="button" data-act="cancel">Cancel</button>
          <button class="btn btn-primary" type="submit">${esc(confirmLabel)}</button>
        </div>
      </form>`, () => finish(null));
    const input = dlg.querySelector('input');
    const err = dlg.querySelector('.dlg-err');
    const okBtn = dlg.querySelector('[type=submit]');
    input.select();
    dlg.querySelector('[data-act=cancel]').addEventListener('click', dismiss);
    dlg.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      if (submit) {
        okBtn.disabled = true;
        try { await submit(v); } catch (ex) { err.textContent = ex.message || String(ex); err.hidden = false; okBtn.disabled = false; return; }
      }
      finish(v);
      dismiss();
    });
  });
}

export function confirmDialog({ title, bodyHtml, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const { dlg, dismiss } = makeDialog('confirm-dlg', `
      <h3>${esc(title)}</h3>
      <div class="dlg-body">${bodyHtml}</div>
      <div class="confirm-actions">
        <button class="btn btn-ghost" type="button" data-act="cancel">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-act="ok">${esc(confirmLabel)}</button>
      </div>`, () => resolve(result));
    dlg.querySelector('[data-act=cancel]').addEventListener('click', dismiss);
    dlg.querySelector('[data-act=ok]').addEventListener('click', () => { result = true; dismiss(); });
    dlg.querySelector('[data-act=cancel]').focus();
  });
}

// What deleting removes, said plainly. Folders are never the reason something is deleted.
export function confirmDeleteRecordings(count, title) {
  const what = count === 1 ? (title ? `“${esc(title)}”` : 'this recording') : `${count} recordings`;
  return confirmDialog({
    title: count === 1 ? 'Delete this recording?' : `Delete ${count} recordings?`,
    bodyHtml: `<p>This permanently removes ${what} from your library, including:</p>
      <ul class="dlg-list"><li>the transcript and speaker names</li><li>summaries, notes and insights</li><li>Ask questions and answers</li><li>anything made in Create (study guides, flashcards, quizzes, recaps, drafts)</li><li>${count === 1 ? 'its place in your folders' : 'their places in your folders'}</li></ul>
      <p class="dlg-dim">This can’t be undone. The original audio kept on this device for playback is deleted too (it was never uploaded; copies on your other devices stay until you delete them there). Deleting doesn’t give back transcription time used this month.</p>`,
    confirmLabel: count === 1 ? 'Delete permanently' : `Delete ${count} permanently`,
    danger: true,
  });
}

// Folder membership for one or more recordings. With one recording the checkboxes show where it is now
// and toggle membership; with several, ticking a folder adds all of them to it.
export function folderPicker({ ids, currentIds = [], onChange }) {
  ids = [].concat(ids);
  const single = ids.length === 1;
  const member = new Set(single ? currentIds : []);
  let changed = false;
  const { dlg, dismiss } = makeDialog('folder-dlg', `
    <h3>${single ? 'Courses' : `Add ${ids.length} recordings to a course`}</h3>
    <div class="folder-pick" aria-live="polite"><div class="lib-skel sm"></div></div>
    <form class="folder-new" autocomplete="off">
      <input type="text" maxlength="80" placeholder="New course name" aria-label="New course name" />
      <button class="btn btn-ghost btn-sm" type="submit">Create</button>
    </form>
    <p class="dlg-err" role="alert" hidden></p>
    <div class="confirm-actions"><button class="btn btn-primary" type="button" data-act="done">Done</button></div>`,
  () => { if (changed) onChange?.([...member]); });
  const list = dlg.querySelector('.folder-pick');
  const err = dlg.querySelector('.dlg-err');
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  let folders = [];

  const render = () => {
    list.innerHTML = folders.length
      ? folders.map((f) => `<label class="folder-opt"><input type="checkbox" data-id="${f.id}" ${member.has(f.id) ? 'checked' : ''} />
          <span class="folder-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg></span>
          <span class="folder-name">${esc(f.name)}</span></label>`).join('')
      : '<p class="dlg-dim">No courses yet. Create one below, e.g. “Biology 201”.</p>';
  };
  const load = async () => {
    try { folders = await listFolders(); render(); } catch (e) { list.innerHTML = ''; showErr(e.message || 'Couldn’t load courses.'); }
  };

  list.addEventListener('change', async (e) => {
    const box = e.target.closest('input[data-id]');
    if (!box) return;
    const id = box.dataset.id;
    box.disabled = true;
    showErr('');
    try {
      if (box.checked) { await addToFolder(id, ids); member.add(id); }
      else { await removeFromFolder(id, ids); member.delete(id); }
      changed = true;
    } catch (ex) { box.checked = !box.checked; showErr(ex.message || 'That didn’t work. Try again.'); }
    box.disabled = false;
  });
  dlg.querySelector('.folder-new').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const name = input.value.trim();
    if (!name) return;
    showErr('');
    try {
      const f = await createFolder(name);
      await addToFolder(f.id, ids);
      member.add(f.id);
      changed = true;
      input.value = '';
      folders = [...folders, f].sort((a, b) => a.name.localeCompare(b.name));
      render();
    } catch (ex) { showErr(ex.message || 'Couldn’t create the course.'); }
  });
  dlg.querySelector('[data-act=done]').addEventListener('click', dismiss);
  load();
}

// Add recordings to a course from inside the course: one searchable list of the whole library, tick several, add them
// in one go. Recordings already in the course are shown ticked and can't be added twice. Resolves with the number
// added (0 when cancelled). Nothing is removed here; removing stays a deliberate per-recording action.
export function addRecordingsDialog({ folderId, folderName, listAll, memberIds }) {
  return new Promise((resolve) => {
    let added = 0;
    const picked = new Set();
    let rows = [];
    let inCourse = new Set();
    const { dlg, dismiss } = makeDialog('add-rec-dlg', `
      <div class="ar-head"><h3>Add recordings to “${esc(folderName)}”</h3><p class="dlg-dim">Pick as many as you like. Recordings can be in more than one course.</p></div>
      <label class="ar-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" placeholder="Filter by title" aria-label="Filter recordings by title" autocomplete="off" /></label>
      <div class="ar-list" role="group" aria-label="Recordings" aria-busy="true"><div class="lib-skel sm"></div><div class="lib-skel sm"></div></div>
      <p class="dlg-err" role="alert" hidden></p>
      <div class="confirm-actions ar-foot"><span class="ar-count" aria-live="polite"></span>
        <button class="btn btn-ghost" type="button" data-act="cancel">Cancel</button>
        <button class="btn btn-primary" type="button" data-act="add" disabled>Add recordings</button></div>`, () => resolve(added));
    const list = dlg.querySelector('.ar-list');
    const input = dlg.querySelector('.ar-search input');
    const addBtn = dlg.querySelector('[data-act=add]');
    const count = dlg.querySelector('.ar-count');
    const err = dlg.querySelector('.dlg-err');
    const fmt = (s) => { const m = Math.round((Number(s) || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.max(1, m)} min`; };
    const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const sync = () => {
      const n = picked.size;
      addBtn.disabled = !n;
      addBtn.textContent = n ? `Add ${n} recording${n === 1 ? '' : 's'}` : 'Add recordings';
      count.textContent = n ? `${n} selected` : '';
    };
    const render = () => {
      const q = input.value.trim().toLowerCase();
      const shown = rows.filter((r) => !q || r.title.toLowerCase().includes(q));
      list.removeAttribute('aria-busy');
      list.innerHTML = shown.length ? shown.map((r) => {
        const here = inCourse.has(r.id);
        return `<label class="ar-row${here ? ' is-member' : ''}"><input type="checkbox" data-id="${r.id}" ${here || picked.has(r.id) ? 'checked' : ''} ${here ? 'disabled' : ''} />
          <span class="ar-box" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19.5 7"/></svg></span>
          <span class="ar-title">${esc(r.title)}</span><span class="ar-meta">${here ? 'In this course' : `${day(r.created_at)} · ${fmt(r.duration_seconds)}`}</span></label>`;
      }).join('') : `<p class="dlg-dim ar-none">${rows.length ? 'No recordings match that.' : 'Your Library is empty. Upload a lecture first.'}</p>`;
    };
    list.addEventListener('change', (e) => {
      const box = e.target.closest('input[data-id]');
      if (!box) return;
      if (box.checked) picked.add(box.dataset.id); else picked.delete(box.dataset.id);
      sync();
    });
    input.addEventListener('input', render);
    dlg.querySelector('[data-act=cancel]').addEventListener('click', dismiss);
    addBtn.addEventListener('click', async () => {
      if (!picked.size) return;
      addBtn.disabled = true;
      err.hidden = true;
      try { await addToFolder(folderId, [...picked]); added = picked.size; dismiss(); } catch (ex) { err.textContent = ex.message || 'That didn’t work. Try again.'; err.hidden = false; addBtn.disabled = false; }
    });
    Promise.all([listAll(), memberIds()]).then(([all, ids]) => { rows = all; inCourse = new Set(ids); render(); input.focus(); },
      (ex) => { list.innerHTML = ''; err.textContent = ex.message || 'Couldn’t load your recordings.'; err.hidden = false; });
    sync();
  });
}

let toastEl;
export function toast(msg, ms = 2200) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('show'), ms);
}

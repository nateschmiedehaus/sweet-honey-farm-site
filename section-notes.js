(function () {
  var API_URL = "/api/section-notes";
  var PROFILE_KEY = "shf_notes_profile_v1";
  var VISIBILITY_KEY = "shf_notes_visible_v1";
  var SECTION_SELECTOR = "main section[id], main .ax-section[id], main .dossier-section[id]";
  var notesStore = { version: 1, notes: {} };
  var profile = loadProfile();
  var dock = null;
  var dockName = null;
  var dockProfileButton = null;
  var visibilitySwitch = null;
  var tools = [];
  var notesVisible = loadVisibility();
  var sharedStatus = "loading";
  var sharedMessage = "Loading shared comments...";

  function loadProfile() {
    try {
      var parsed = JSON.parse(window.localStorage.getItem(PROFILE_KEY) || "null");
      if (parsed && parsed.name) return parsed;
    } catch (error) {}

    return null;
  }

  function loadVisibility() {
    return window.localStorage.getItem(VISIBILITY_KEY) !== "hidden";
  }

  function saveProfile(nextProfile) {
    profile = nextProfile;
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    updateDock();
    tools.forEach(renderTool);
  }

  function setNotesVisible(isVisible) {
    notesVisible = isVisible;
    window.localStorage.setItem(VISIBILITY_KEY, isVisible ? "visible" : "hidden");
    document.documentElement.classList.toggle("shf-notes-hidden", !isVisible);
    updateDock();
  }

  function promptForProfile() {
    var currentName = profile && profile.name ? profile.name : "";
    var name = window.prompt("Name to tag your notes with:", currentName);
    return saveProfileFromName(name);
  }

  function saveProfileFromName(name) {
    if (!name) return null;
    name = name.trim().replace(/\s+/g, " ");
    if (!name) return null;

    var nextProfile = {
      name: name,
      hue: hueForName(name)
    };
    saveProfile(nextProfile);
    return nextProfile;
  }

  function ensureProfile(tool) {
    if (profile) return profile;
    var inputName = tool && tool.nameInput ? tool.nameInput.value : "";
    var nextProfile = saveProfileFromName(inputName);
    if (nextProfile) return nextProfile;
    if (tool && tool.nameInput) tool.nameInput.focus();
    return null;
  }

  function hueForName(name) {
    var hash = 0;
    for (var index = 0; index < name.length; index += 1) {
      hash = (hash * 31 + name.charCodeAt(index)) % 360;
    }

    return (hash + 22) % 360;
  }

  function initialsForName(name) {
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map(function (part) {
        return part.charAt(0).toUpperCase();
      })
      .join("");
  }

  function pageKey() {
    var path = window.location.pathname || "index.html";
    var fileName = path.split("/").pop() || "index.html";
    if (fileName === "source.html") return "index.html";
    return fileName;
  }

  function noteKey(section) {
    return pageKey() + "#" + section.id;
  }

  function sectionTitle(section) {
    var heading = section.querySelector("h1, h2, h3, h4");
    if (heading && heading.textContent.trim()) return heading.textContent.trim();
    return section.id.replace(/[-_]/g, " ");
  }

  function notesFor(key) {
    if (!notesStore.notes[key]) notesStore.notes[key] = [];
    return notesStore.notes[key];
  }

  function setNotes(key, notes) {
    notesStore.notes[key] = Array.isArray(notes) ? notes : [];
  }

  function defaultPosition(index) {
    return {
      x: Math.min(76, 58 + (index % 3) * 7),
      y: Math.min(78, 10 + (index % 5) * 11)
    };
  }

  function notePosition(note, index) {
    if (note.position && Number.isFinite(note.position.x) && Number.isFinite(note.position.y)) {
      return {
        x: Math.max(1, Math.min(88, note.position.x)),
        y: Math.max(1, Math.min(88, note.position.y))
      };
    }

    return defaultPosition(index);
  }

  function applyStickyPosition(card, position) {
    card.style.left = position.x + "%";
    card.style.top = position.y + "%";
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(new Date(value));
    } catch (error) {
      return "";
    }
  }

  function makeElement(tagName, className, text) {
    var element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function setSharedStatus(status, message) {
    sharedStatus = status;
    sharedMessage = message;
    tools.forEach(renderTool);
  }

  function apiRequest(method, body) {
    return fetch(API_URL, {
      method: method,
      headers: {
        "content-type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (response) {
      return response.json().catch(function () {
        return {};
      }).then(function (payload) {
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Comment request failed.");
        }
        return payload;
      });
    });
  }

  function fetchSharedNotes() {
    if (!tools.length) return Promise.resolve();

    var keys = tools.map(function (tool) {
      return tool.key;
    });

    setSharedStatus("loading", "Loading shared comments...");
    return fetch(API_URL + "?keys=" + encodeURIComponent(keys.join(",")), {
      cache: "no-store"
    })
      .then(function (response) {
        return response.json().catch(function () {
          return {};
        }).then(function (payload) {
          if (!response.ok || payload.ok === false) {
            throw new Error(payload.error || "Shared comments are unavailable.");
          }
          Object.keys(payload.notes || {}).forEach(function (key) {
            setNotes(key, payload.notes[key]);
          });
          setSharedStatus("ready", "Shared comments are live.");
        });
      })
      .catch(function (error) {
        setSharedStatus("offline", error.message || "Shared comments are unavailable.");
      });
  }

  function addNote(tool, text) {
    var activeProfile = ensureProfile(tool);
    if (!activeProfile || sharedStatus !== "ready") return;
    var position = defaultPosition(notesFor(tool.key).length);

    tool.submit.disabled = true;
    apiRequest("POST", {
      sectionKey: tool.key,
      author: activeProfile.name,
      hue: activeProfile.hue,
      text: text,
      position: position
    })
      .then(function (payload) {
        notesFor(tool.key).push(payload.note);
        renderTool(tool);
      })
      .catch(function (error) {
        setSharedStatus("offline", error.message || "Comment was not saved.");
      })
      .finally(function () {
        tool.submit.disabled = false;
      });
  }

  function patchNote(tool, note, body) {
    if (sharedStatus !== "ready") return Promise.resolve();
    return apiRequest("PATCH", Object.assign({
      sectionKey: tool.key,
      id: note.id
    }, body))
      .then(function (payload) {
        notesStore.notes[tool.key] = notesFor(tool.key).map(function (item) {
          return item.id === note.id ? payload.note : item;
        });
        renderTool(tool);
        return payload.note;
      });
  }

  function updateNote(tool, note, text) {
    if (!text || sharedStatus !== "ready") return;
    patchNote(tool, note, { text: text })
      .catch(function (error) {
        setSharedStatus("offline", error.message || "Comment was not updated.");
      });
  }

  function updateNotePosition(tool, note, position) {
    if (sharedStatus !== "ready") return;
    note.position = position;
    patchNote(tool, note, { position: position })
      .catch(function (error) {
        setSharedStatus("offline", error.message || "Sticky note position was not saved.");
      });
  }

  function deleteNote(tool, id) {
    if (sharedStatus !== "ready") return;
    if (!window.confirm("Delete this comment for everyone?")) return;

    apiRequest("DELETE", {
      sectionKey: tool.key,
      id: id
    })
      .then(function () {
        notesStore.notes[tool.key] = notesFor(tool.key).filter(function (note) {
          return note.id !== id;
        });
        renderTool(tool);
      })
      .catch(function (error) {
        setSharedStatus("offline", error.message || "Comment was not deleted.");
      });
  }

  function renderNote(tool, note) {
    var card = makeElement("article", "shf-note");
    card.style.setProperty("--note-hue", note.hue || hueForName(note.author || "Reviewer"));

    var head = makeElement("div", "shf-note-head");
    var author = makeElement("div", "shf-note-author");
    author.appendChild(makeElement("span", "shf-note-avatar", initialsForName(note.author || "Reviewer")));
    author.appendChild(makeElement("strong", "shf-note-name", note.author || "Reviewer"));
    head.appendChild(author);

    var metaText = formatDate(note.updatedAt || note.createdAt);
    if (note.updatedAt) metaText += " edited";
    head.appendChild(makeElement("div", "shf-note-time", metaText));

    var controls = makeElement("div", "shf-note-controls");
    var edit = makeElement("button", "shf-notes-delete", "Edit");
    var remove = makeElement("button", "shf-notes-delete", "Delete");
    edit.type = "button";
    remove.type = "button";
    controls.appendChild(edit);
    controls.appendChild(remove);
    head.appendChild(controls);

    var body = makeElement("p", "shf-note-body", note.text);
    var editForm = makeElement("form", "shf-note-edit is-hidden");
    var editInput = makeElement("textarea", "shf-notes-input", "");
    editInput.value = note.text;
    var editActions = makeElement("div", "shf-notes-actions");
    var cancel = makeElement("button", "shf-notes-identity", "Cancel");
    var save = makeElement("button", "shf-notes-submit", "Save edit");
    cancel.type = "button";
    save.type = "submit";
    editActions.appendChild(cancel);
    editActions.appendChild(save);
    editForm.appendChild(editInput);
    editForm.appendChild(editActions);

    edit.addEventListener("click", function () {
      body.classList.add("is-hidden");
      editForm.classList.remove("is-hidden");
      editInput.focus();
    });

    cancel.addEventListener("click", function () {
      editInput.value = note.text;
      editForm.classList.add("is-hidden");
      body.classList.remove("is-hidden");
    });

    editForm.addEventListener("submit", function (event) {
      event.preventDefault();
      updateNote(tool, note, editInput.value.trim());
    });

    remove.addEventListener("click", function () {
      deleteNote(tool, note.id);
    });

    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(editForm);
    return card;
  }

  function renderStickyNote(tool, note, index) {
    var card = makeElement("article", "shf-sticky-note");
    var position = notePosition(note, index);
    card.style.setProperty("--note-hue", note.hue || hueForName(note.author || "Reviewer"));
    card.dataset.noteId = note.id;
    applyStickyPosition(card, position);

    var grip = makeElement("div", "shf-sticky-grip");
    grip.appendChild(makeElement("span", "shf-note-avatar", initialsForName(note.author || "Reviewer")));
    grip.appendChild(makeElement("strong", "shf-note-name", note.author || "Reviewer"));
    grip.appendChild(makeElement("span", "shf-sticky-drag-label", "Drag"));

    var body = makeElement("p", "shf-note-body", note.text);
    var controls = makeElement("div", "shf-note-controls");
    var edit = makeElement("button", "shf-notes-delete", "Edit");
    var remove = makeElement("button", "shf-notes-delete", "Delete");
    edit.type = "button";
    remove.type = "button";
    controls.appendChild(edit);
    controls.appendChild(remove);

    edit.addEventListener("click", function () {
      var text = window.prompt("Edit this comment for everyone:", note.text);
      if (text === null) return;
      updateNote(tool, note, text.trim());
    });

    remove.addEventListener("click", function () {
      deleteNote(tool, note.id);
    });

    card.appendChild(grip);
    card.appendChild(body);
    card.appendChild(controls);
    makeDraggable(tool, note, card);
    return card;
  }

  function makeDraggable(tool, note, card) {
    var state = null;

    function startDrag(event) {
      if (state) return;
      var point = event.touches && event.touches[0] ? event.touches[0] : event;
      if ((event.button !== undefined && event.button !== 0) || event.target.closest("button, textarea, input, a")) return;
      var sectionRect = tool.section.getBoundingClientRect();
      var cardRect = card.getBoundingClientRect();

      state = {
        sectionRect: sectionRect,
        offsetX: point.clientX - cardRect.left,
        offsetY: point.clientY - cardRect.top,
        moved: false
      };

      card.classList.add("is-dragging");
      if (event.pointerId !== undefined && card.setPointerCapture) {
        card.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
    }

    function moveDrag(event) {
      if (!state) return;
      var point = event.touches && event.touches[0] ? event.touches[0] : event;
      var x = ((point.clientX - state.sectionRect.left - state.offsetX) / state.sectionRect.width) * 100;
      var y = ((point.clientY - state.sectionRect.top - state.offsetY) / state.sectionRect.height) * 100;
      var position = {
        x: Math.max(1, Math.min(88, x)),
        y: Math.max(1, Math.min(88, y))
      };

      state.moved = true;
      note.position = position;
      applyStickyPosition(card, position);
      event.preventDefault();
    }

    function endDrag(event) {
      if (!state) return;
      if (event.pointerId !== undefined && card.releasePointerCapture) {
        card.releasePointerCapture(event.pointerId);
      }
      card.classList.remove("is-dragging");
      if (state.moved) updateNotePosition(tool, note, note.position);
      state = null;
    }

    card.addEventListener("pointerdown", startDrag);
    card.addEventListener("pointermove", moveDrag);
    card.addEventListener("pointerup", endDrag);
    card.addEventListener("mousedown", startDrag);
    window.addEventListener("mousemove", moveDrag);
    window.addEventListener("mouseup", endDrag);
    card.addEventListener("touchstart", startDrag, { passive: false });
    window.addEventListener("touchmove", moveDrag, { passive: false });
    window.addEventListener("touchend", endDrag);

    card.addEventListener("pointercancel", function () {
      card.classList.remove("is-dragging");
      state = null;
    });
  }

  function renderTool(tool) {
    var notes = notesFor(tool.key);
    tool.count.textContent = String(notes.length);
    tool.list.replaceChildren();
    tool.stickyLayer.replaceChildren();
    tool.status.textContent = sharedMessage;
    tool.status.dataset.status = sharedStatus;
    tool.submit.disabled = sharedStatus !== "ready";
    tool.input.disabled = sharedStatus !== "ready";

    if (notes.length === 0) {
      tool.list.appendChild(makeElement("p", "shf-notes-empty", "No notes yet for this section."));
    } else {
      notes.forEach(function (note) {
        tool.list.appendChild(renderNote(tool, note));
      });
    }

    notes.forEach(function (note, index) {
      tool.stickyLayer.appendChild(renderStickyNote(tool, note, index));
    });

    if (profile) {
      tool.identity.style.setProperty("--note-hue", profile.hue);
      tool.identity.textContent = "Add as " + profile.name;
      tool.nameRow.classList.add("is-hidden");
      tool.personText.textContent = "Tagging as " + profile.name;
      tool.personDot.style.setProperty("--note-hue", profile.hue);
    } else {
      tool.identity.style.removeProperty("--note-hue");
      tool.identity.textContent = "Set name";
      tool.nameRow.classList.remove("is-hidden");
      tool.personText.textContent = "Name not set";
      tool.personDot.style.removeProperty("--note-hue");
    }
  }

  function createTool(section) {
    var key = noteKey(section);
    var wrapper = makeElement("div", "shf-notes-tool");
    var stickyLayer = makeElement("div", "shf-sticky-layer");
    wrapper.dataset.sectionNotes = key;

    var toolbar = makeElement("div", "shf-notes-toolbar");
    var toggle = makeElement("button", "shf-notes-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open notes for " + sectionTitle(section));

    var label = makeElement("span", null, "Notes");
    var count = makeElement("span", "shf-notes-count", "0");
    toggle.appendChild(label);
    toggle.appendChild(count);
    toolbar.appendChild(toggle);

    var person = makeElement("span", "shf-notes-person");
    var dot = makeElement("span", "shf-notes-dot");
    var personText = makeElement("span", null, "");
    person.appendChild(dot);
    person.appendChild(personText);
    toolbar.appendChild(person);
    wrapper.appendChild(toolbar);

    var panel = makeElement("div", "shf-notes-panel");
    var status = makeElement("div", "shf-notes-status", sharedMessage);
    var list = makeElement("div", "shf-notes-list");
    var form = makeElement("form", "shf-notes-form");
    var nameRow = makeElement("div", "shf-notes-name-row");
    var nameLabel = makeElement("label", null, "Your name");
    var nameInput = makeElement("input", "shf-notes-name-input");
    nameInput.type = "text";
    nameInput.autocomplete = "name";
    nameInput.placeholder = "Name for note tags";
    nameLabel.setAttribute("for", "shf-note-name-" + section.id);
    nameInput.id = "shf-note-name-" + section.id;
    var input = makeElement("textarea", "shf-notes-input");
    input.placeholder = "Add a note for everyone viewing this section";
    input.required = true;

    var actions = makeElement("div", "shf-notes-actions");
    var identity = makeElement("button", "shf-notes-identity");
    identity.type = "button";
    var submit = makeElement("button", "shf-notes-submit", "Add note");
    submit.type = "submit";

    actions.appendChild(identity);
    actions.appendChild(submit);
    nameRow.appendChild(nameLabel);
    nameRow.appendChild(nameInput);
    form.appendChild(nameRow);
    form.appendChild(input);
    form.appendChild(actions);
    panel.appendChild(status);
    panel.appendChild(list);
    panel.appendChild(form);
    wrapper.appendChild(panel);

    var tool = {
      section: section,
      key: key,
      wrapper: wrapper,
      stickyLayer: stickyLayer,
      count: count,
      list: list,
      status: status,
      input: input,
      submit: submit,
      identity: identity,
      nameRow: nameRow,
      nameInput: nameInput,
      personText: personText,
      personDot: dot
    };

    toggle.addEventListener("click", function () {
      var isOpen = wrapper.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      if (isOpen && sharedStatus === "ready") input.focus();
    });

    identity.addEventListener("click", function () {
      if (profile) {
        promptForProfile();
      } else {
        nameInput.focus();
      }
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      addNote(tool, text);
      input.value = "";
      input.focus();
    });

    tools.push(tool);
    renderTool(tool);
    return {
      wrapper: wrapper,
      stickyLayer: stickyLayer
    };
  }

  function mountTool(section) {
    if (!section.id || section.dataset.notesReady === "true") return;
    section.dataset.notesReady = "true";
    section.classList.add("shf-notes-section");

    var mount = section.querySelector(":scope > .container, :scope > .container-wide") || section;
    var heading = mount.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4");
    var toolParts = createTool(section);

    section.appendChild(toolParts.stickyLayer);

    if (heading && heading.nextSibling) {
      mount.insertBefore(toolParts.wrapper, heading.nextSibling);
    } else if (heading) {
      mount.appendChild(toolParts.wrapper);
    } else {
      mount.insertBefore(toolParts.wrapper, mount.firstChild);
    }
  }

  function updateDock() {
    if (!dock) return;
    dockName.textContent = profile && profile.name ? profile.name : "Not set";
    dockProfileButton.textContent = profile ? "Switch" : "Sign in";
    if (profile) {
      dock.style.setProperty("--note-hue", profile.hue);
    } else {
      dock.style.removeProperty("--note-hue");
    }
    visibilitySwitch.setAttribute("aria-checked", notesVisible ? "true" : "false");
    visibilitySwitch.textContent = notesVisible ? "Notes on" : "Notes off";
  }

  function mountDock() {
    dock = makeElement("div", "shf-notes-dock");
    var identity = makeElement("div", "shf-notes-dock-identity");
    var label = makeElement("span", null, "Reviewer");
    dockName = makeElement("strong", null, profile && profile.name ? profile.name : "Not set");
    dockProfileButton = makeElement("button", "shf-notes-identity", profile ? "Switch" : "Sign in");
    dockProfileButton.type = "button";
    dockProfileButton.addEventListener("click", promptForProfile);

    visibilitySwitch = makeElement("button", "shf-notes-switch");
    visibilitySwitch.type = "button";
    visibilitySwitch.setAttribute("role", "switch");
    visibilitySwitch.addEventListener("click", function () {
      setNotesVisible(!notesVisible);
    });

    identity.appendChild(label);
    identity.appendChild(dockName);
    identity.appendChild(dockProfileButton);
    dock.appendChild(identity);
    dock.appendChild(visibilitySwitch);
    document.body.appendChild(dock);
    updateDock();
  }

  function init() {
    var sections = Array.prototype.slice.call(document.querySelectorAll(SECTION_SELECTOR));
    sections.forEach(mountTool);
    if (sections.length) {
      setNotesVisible(notesVisible);
      mountDock();
      fetchSharedNotes();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

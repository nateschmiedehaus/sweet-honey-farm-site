(function () {
  var API_URL = "/api/section-notes";
  var PROFILE_KEY = "shf_notes_profile_v1";
  var SECTION_SELECTOR = "main section[id], main .ax-section[id], main .dossier-section[id]";
  var notesStore = { version: 1, notes: {} };
  var profile = loadProfile();
  var loginPill = null;
  var tools = [];
  var sharedStatus = "loading";
  var sharedMessage = "Loading shared comments...";

  function loadProfile() {
    try {
      var parsed = JSON.parse(window.localStorage.getItem(PROFILE_KEY) || "null");
      if (parsed && parsed.name) return parsed;
    } catch (error) {}

    return null;
  }

  function saveProfile(nextProfile) {
    profile = nextProfile;
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    updateLoginPill();
    tools.forEach(renderTool);
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

    tool.submit.disabled = true;
    apiRequest("POST", {
      sectionKey: tool.key,
      author: activeProfile.name,
      hue: activeProfile.hue,
      text: text
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

  function updateNote(tool, note, text) {
    if (!text || sharedStatus !== "ready") return;
    apiRequest("PATCH", {
      sectionKey: tool.key,
      id: note.id,
      text: text
    })
      .then(function (payload) {
        notesStore.notes[tool.key] = notesFor(tool.key).map(function (item) {
          return item.id === note.id ? payload.note : item;
        });
        renderTool(tool);
      })
      .catch(function (error) {
        setSharedStatus("offline", error.message || "Comment was not updated.");
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

  function renderTool(tool) {
    var notes = notesFor(tool.key);
    tool.count.textContent = String(notes.length);
    tool.list.replaceChildren();
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
    return wrapper;
  }

  function mountTool(section) {
    if (!section.id || section.dataset.notesReady === "true") return;
    section.dataset.notesReady = "true";
    section.classList.add("shf-notes-section");

    var mount = section.querySelector(":scope > .container, :scope > .container-wide") || section;
    var heading = mount.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4");
    var tool = createTool(section);

    if (heading && heading.nextSibling) {
      mount.insertBefore(tool, heading.nextSibling);
    } else if (heading) {
      mount.appendChild(tool);
    } else {
      mount.insertBefore(tool, mount.firstChild);
    }
  }

  function updateLoginPill() {
    if (!loginPill) return;
    loginPill.replaceChildren();

    var label = makeElement("span", null, "Reviewer");
    var name = makeElement("strong", null, profile && profile.name ? profile.name : "Not set");
    var button = makeElement("button", "shf-notes-identity", profile ? "Switch" : "Sign in");
    button.type = "button";
    button.addEventListener("click", promptForProfile);

    if (profile) loginPill.style.setProperty("--note-hue", profile.hue);
    loginPill.appendChild(label);
    loginPill.appendChild(name);
    loginPill.appendChild(button);
  }

  function mountLoginPill() {
    loginPill = makeElement("div", "shf-notes-login");
    document.body.appendChild(loginPill);
    updateLoginPill();
  }

  function init() {
    var sections = Array.prototype.slice.call(document.querySelectorAll(SECTION_SELECTOR));
    sections.forEach(mountTool);
    if (sections.length) {
      mountLoginPill();
      fetchSharedNotes();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

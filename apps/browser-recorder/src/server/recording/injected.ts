import { MAX_ASSERTION_TEXT_LENGTH } from "@/shared/contracts/workflow/domain";

export const RECORDER_BINDING = "__browserMemoryEmit";

export const RECORDER_SCRIPT = String.raw`(() => {
  if (window.__browserMemoryRecorderInstalled) return;
  window.__browserMemoryRecorderInstalled = true;

  const dirtyFields = new Set();
  let datePickerOpen = false;
  let selectPickerOpen = false;
  let pendingOptionClick = null;
  let suppressKeyboardClick = false;
  let suppressKeyboardClickTimer = null;
  let assertionPickerRequestId = null;
  let assertionPickerHighlights = [];
  let assertionPickerPanelHost = null;
  let assertionGroupCandidates = [];
  let assertionSelectedGroupIndex = null;
  let assertionPickerSeed = null;
  let assertionGroupLocked = false;
  let assertionFrozenGroup = null;
  let assertionGroupObserver = null;
  let assertionGroupRefreshFrame = null;
  let assertionPickerPanelActive = false;
  const assertionPickerFrameId = crypto.randomUUID();
  const assertionPickerFrameChannel = "__browserMemoryAssertionPickerFrame";
  window.__browserMemorySuppressSelectChange = false;
  window.__browserMemoryNativeSelects = window.__browserMemoryNativeSelects === true;
  window.__browserMemoryCaptchaLocked = window.__browserMemoryCaptchaLocked === true;
  const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const clip = (value, size = 180) => normalize(value).slice(0, size);
  const escapeCss = (value) => window.CSS?.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");

  const clearAssertionHighlight = () => {
    for (const { element, styles } of assertionPickerHighlights) {
      for (const [property, value, priority] of styles) {
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
    }
    assertionPickerHighlights = [];
  };

  const highlightAssertionTargets = (elements, color, cursor = "crosshair") => {
    clearAssertionHighlight();
    assertionPickerHighlights = elements.map((element) => ({
      element,
      styles: ["outline", "outline-offset", "cursor"].map((property) => [
        property,
        element.style.getPropertyValue(property),
        element.style.getPropertyPriority(property),
      ]),
    }));
    for (const element of elements) {
      element.style.setProperty("outline", "2px solid " + color, "important");
      element.style.setProperty("outline-offset", "2px", "important");
      element.style.setProperty("cursor", cursor, "important");
    }
  };

  const highlightAssertionTarget = (element) => highlightAssertionTargets([element], "#2f6feb");

  const emit = (payload) => {
    if (window.__browserMemoryCaptchaLocked) return;
    try {
      const result = window.${RECORDER_BINDING}?.(payload);
      if (result?.catch) result.catch(() => undefined);
    } catch {}
  };

  const postAssertionPickerFrameState = (frameId) => {
    const message = {
      channel: assertionPickerFrameChannel,
      kind: "active",
      requestId: assertionPickerRequestId,
      frameId,
    };
    for (let index = 0; index < window.frames.length; index += 1) {
      try { window.frames[index].postMessage(message, "*"); } catch {}
    }
  };

  const setAssertionPickerPanelActive = (active) => {
    assertionPickerPanelActive = active === true;
    if (!assertionPickerRequestId) return;
    if (assertionPickerPanelActive && !assertionPickerPanelHost) mountAssertionPickerPanel();
    if (!assertionPickerPanelHost) return;
    assertionPickerPanelHost.style.setProperty("display", assertionPickerPanelActive ? "block" : "none", "important");
    if (!assertionPickerPanelActive) {
      clearAssertionHighlight();
      return;
    }
    if (assertionPickerSeed) refreshAssertionGroups();
  };

  const broadcastActiveAssertionPickerFrame = (frameId) => {
    setAssertionPickerPanelActive(frameId === assertionPickerFrameId);
    postAssertionPickerFrameState(frameId);
  };

  const activateCurrentAssertionPickerFrame = () => {
    if (!assertionPickerRequestId) return;
    if (window === window.top) {
      broadcastActiveAssertionPickerFrame(assertionPickerFrameId);
      return;
    }
    setAssertionPickerPanelActive(true);
    try {
      window.top.postMessage({
        channel: assertionPickerFrameChannel,
        kind: "request",
        requestId: assertionPickerRequestId,
        frameId: assertionPickerFrameId,
      }, "*");
    } catch {}
  };

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.channel !== assertionPickerFrameChannel || message.requestId !== assertionPickerRequestId) return;
    if (message.kind === "request") {
      if (window === window.top) broadcastActiveAssertionPickerFrame(message.frameId);
      return;
    }
    if (message.kind !== "active") return;
    setAssertionPickerPanelActive(message.frameId === assertionPickerFrameId);
    postAssertionPickerFrameState(message.frameId);
  });

  window.__browserMemorySetNativeSelects = (enabled) => {
    window.__browserMemoryNativeSelects = enabled === true;
    if (window.__browserMemoryNativeSelects) selectPickerOpen = false;
  };
  window.__browserMemorySetAssertionPicker = (requestId) => {
    clearAssertionHighlight();
    teardownAssertionPickerPanel();
    assertionPickerRequestId = typeof requestId === "string" && requestId ? requestId : null;
    if (assertionPickerRequestId && window === window.top) activateCurrentAssertionPickerFrame();
  };
  window.__browserMemorySetCaptchaLocked = (locked) => {
    window.__browserMemoryCaptchaLocked = locked === true;
    if (!window.__browserMemoryCaptchaLocked) return;
    dirtyFields.clear();
    datePickerOpen = false;
    selectPickerOpen = false;
    if (pendingOptionClick) clearTimeout(pendingOptionClick.timer);
    pendingOptionClick = null;
    if (suppressKeyboardClickTimer) clearTimeout(suppressKeyboardClickTimer);
    suppressKeyboardClick = false;
    suppressKeyboardClickTimer = null;
    window.__browserMemorySetAssertionPicker(null);
  };

  const viewportPosition = () => ({
    x: window.scrollX,
    y: window.scrollY,
    frameUrl: window === window.top ? undefined : location.href,
  });
  const emitAction = (payload) => emit({ ...payload, position: viewportPosition() });

  const eventElement = (event) => {
    const origin = event.composedPath?.().find((item) => item instanceof Element);
    return origin instanceof Element
      ? origin
      : event.target instanceof Element
        ? event.target
        : null;
  };

  const assertionEventElement = (event) => {
    const origin = event.composedPath?.().find((item) => item instanceof HTMLElement);
    const element = origin instanceof HTMLElement
      ? origin
      : event.target instanceof HTMLElement
        ? event.target
        : null;
    return element?.closest("[data-testid],button,a[href],input,select,textarea,[role]") || element;
  };

  const implicitRole = (element) => {
    const tag = element.tagName.toLowerCase();
    const type = String(element.getAttribute("type") || "").toLowerCase();
    if (tag === "article") return "article";
    if (tag === "button") return "button";
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (tag === "nav") return "navigation";
    if (tag === "main") return "main";
    if (tag === "form") return "form";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return element.multiple ? "listbox" : "combobox";
    if (tag === "input") {
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type !== "hidden") return "textbox";
    }
    return "";
  };

  const labelText = (label) => {
    const copy = label.cloneNode(true);
    copy.querySelectorAll("input,textarea,select,button").forEach((control) => control.remove());
    return clip(copy.textContent || "");
  };

  const displayLabelText = (value) => clip(value, 120).replace(/\s*[*\u2731]+\s*$/, "").trim();

  const labelFor = (element) => {
    if (element.labels?.length) return clip([...element.labels].map(labelText).join(" "));
    const wrapping = element.closest("label");
    return wrapping ? labelText(wrapping) : "";
  };

  const accessibleName = (element) => {
    const aria = element.getAttribute("aria-label");
    if (aria) return clip(aria);
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const value = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ");
      if (normalize(value)) return clip(value);
    }
    const label = labelFor(element);
    if (label) return label;
    if (element instanceof HTMLImageElement && element.alt) return clip(element.alt);
    if (element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)) return clip(element.value);
    return clip(element.innerText || element.textContent || element.getAttribute("title") || element.getAttribute("placeholder") || "");
  };

  const isVisible = (element) => {
    if (!(element instanceof HTMLElement) || element.closest('[aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };

  const isAssertionPickerUiEvent = (event) => Boolean(
    assertionPickerPanelHost && event.composedPath?.().includes(assertionPickerPanelHost)
  );

  const structuralRole = (element) => {
    const explicit = normalize(element.getAttribute("role") || "").toLowerCase();
    return explicit ? explicit.split(/\s+/)[0] : implicitRole(element);
  };

  const structuralSegment = (element) => element.tagName.toLowerCase() + ":" + structuralRole(element);

  const describeStructuralGroup = (root) => {
    const tokens = new Set(["0:" + structuralSegment(root)]);
    let visitedDescendants = 0;
    const visit = (element, depth, path) => {
      if (depth > 3 || visitedDescendants >= 150) return;
      for (const child of element.children) {
        if (visitedDescendants >= 150) break;
        visitedDescendants += 1;
        const childPath = [...path, structuralSegment(child)];
        tokens.add(depth + ":" + childPath.join(">"));
        visit(child, depth + 1, childPath);
      }
    };
    visit(root, 1, []);
    const role = structuralRole(root);
    return {
      root: {
        tagName: root.tagName.toLowerCase(),
        ...(role ? { role } : {}),
        sharedClasses: [...root.classList].sort(),
      },
      structureTokens: [...tokens].sort(),
    };
  };

  const structuralSimilarity = (recorded, candidate) => {
    if (recorded.root.tagName !== candidate.root.tagName || (recorded.root.role || "") !== (candidate.root.role || "")) return 0;
    const recordedTokens = new Set(recorded.structureTokens);
    const candidateTokens = new Set(candidate.structureTokens);
    const union = new Set([...recordedTokens, ...candidateTokens]);
    let shared = 0;
    for (const token of recordedTokens) if (candidateTokens.has(token)) shared += 1;
    return union.size ? shared / union.size : 1;
  };

  const repeatedGroupFor = (parent, templateDescription) => {
    const members = [...parent.children].filter((candidate) =>
        candidate !== assertionPickerPanelHost &&
        isVisible(candidate) &&
        candidate.tagName.toLowerCase() === templateDescription.root.tagName &&
        structuralRole(candidate) === (templateDescription.root.role || "") &&
        structuralSimilarity(templateDescription, describeStructuralGroup(candidate)) >= 0.7
    );
    const sharedClasses = templateDescription.root.sharedClasses.filter((className) =>
      members.every((member) => member.classList.contains(className))
    );
    return {
      parent,
      templateDescription,
      members,
      template: {
        version: 1,
        algorithm: "structural-token-v1",
        ...(window === window.top ? {} : { frameUrl: location.href }),
        root: { ...templateDescription.root, sharedClasses },
        structureTokens: templateDescription.structureTokens,
        capturedMatchCount: members.length,
      },
    };
  };

  const discoverRepeatedGroups = (seed) => {
    const groups = [];
    let ancestor = seed;
    for (let depth = 0; depth < 6 && ancestor; depth += 1) {
      if (ancestor === document.body || ancestor === document.documentElement || ancestor === assertionPickerPanelHost) break;
      const parent = ancestor.parentElement;
      if (!parent) break;
      const group = repeatedGroupFor(parent, describeStructuralGroup(ancestor));
      const members = group.members;
      if (members.length >= 2) {
        groups.push(group);
      }
      ancestor = parent;
    }
    return groups;
  };

  const teardownAssertionPickerPanel = () => {
    if (assertionGroupObserver) assertionGroupObserver.disconnect();
    assertionGroupObserver = null;
    if (assertionGroupRefreshFrame !== null) cancelAnimationFrame(assertionGroupRefreshFrame);
    assertionGroupRefreshFrame = null;
    assertionPickerPanelHost?.remove();
    assertionPickerPanelHost = null;
    assertionGroupCandidates = [];
    assertionSelectedGroupIndex = null;
    assertionPickerSeed = null;
    assertionGroupLocked = false;
    assertionFrozenGroup = null;
    assertionPickerPanelActive = false;
  };

  const freezeAssertionGroup = (index) => {
    if (!assertionGroupCandidates[index]) return;
    assertionGroupLocked = true;
    assertionFrozenGroup = assertionGroupCandidates[index];
    assertionGroupCandidates = [assertionFrozenGroup];
    assertionSelectedGroupIndex = 0;
    highlightAssertionTargets(assertionFrozenGroup.members, "#285bd6");
    renderAssertionPickerPanel();
  };

  const renderAssertionPickerPanel = () => {
    const root = assertionPickerPanelHost?.shadowRoot;
    if (!root) return;
    const content = root.querySelector("[data-content]");
    if (!content) return;
    content.replaceChildren();

    const selected = assertionSelectedGroupIndex === null ? null : assertionGroupCandidates[assertionSelectedGroupIndex];
    const groupUsable = Boolean(assertionGroupLocked && selected && selected.members.length >= 2);

    const heading = document.createElement("h2");
    heading.textContent = selected ? "Repeated group found" : "Select an element";
    content.append(heading);

    if (selected) {
      const summary = document.createElement("p");
      summary.className = "match-summary";
      summary.setAttribute("role", "status");
      const marker = document.createElement("span");
      marker.className = "match-marker";
      marker.setAttribute("aria-hidden", "true");
      marker.textContent = "✓";
      const count = document.createElement("span");
      count.textContent = selected.members.length + " matching containers";
      summary.append(marker, count);
      content.append(summary);
    }

    const guidance = document.createElement("p");
    guidance.className = "guidance";
    guidance.textContent = assertionGroupLocked && selected && selected.members.length < 2
      ? "Group selected, but it now has fewer than two visible members. Restore another match or continue picking."
      : assertionGroupLocked && selected
        ? "Group selected. Moving the pointer will not change it."
        : selected
          ? "Click a highlighted result to freeze this group."
      : assertionPickerSeed
        ? "No repeated group found here. Click this element to select it exactly, or hover elsewhere."
        : "Hover to preview repeated structural groups, or click an unmatched element to select it exactly.";
    content.append(guidance);

    const list = document.createElement("div");
    list.className = "group-list";
    for (const [index, group] of assertionGroupCandidates.entries()) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "group-row" + (assertionSelectedGroupIndex === index ? " selected" : "");
      row.setAttribute("aria-label", group.template.root.tagName + " group, " + group.members.length + " matches");
      row.setAttribute("aria-pressed", assertionGroupLocked && assertionSelectedGroupIndex === index ? "true" : "false");
      const title = document.createElement("strong");
      title.textContent = group.template.root.tagName + (group.template.root.role ? " · " + group.template.root.role : "");
      const meta = document.createElement("span");
      meta.textContent = group.members.length + " matches · " + group.template.structureTokens.length + " structural tokens";
      row.append(title, meta);
      row.addEventListener("click", () => freezeAssertionGroup(index));
      list.append(row);
    }
    content.append(list);

    if (selected) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Template JSON";
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(selected.template, null, 2);
      details.append(summary, pre);
      content.append(details);
    }

    const actions = document.createElement("div");
    actions.className = "actions";
    const use = document.createElement("button");
    use.type = "button";
    use.className = "primary";
    use.textContent = "Use matched group";
    use.hidden = !selected;
    use.disabled = !groupUsable;
    use.addEventListener("click", () => {
      if (!groupUsable || !selected || !assertionPickerRequestId) return;
      const requestId = assertionPickerRequestId;
      const groupTarget = selected.template;
      const name = "Repeated " + groupTarget.root.tagName + " group";
      window.__browserMemorySetAssertionPicker(null);
      emit({ type: "assertion-picker.group-selected", requestId, name, groupTarget, position: viewportPosition() });
    });
    const exact = document.createElement("button");
    exact.type = "button";
    exact.className = "secondary";
    exact.textContent = "Use exact element instead";
    exact.hidden = !assertionGroupLocked;
    exact.disabled = !assertionPickerSeed?.isConnected;
    exact.addEventListener("click", () => {
      if (!assertionGroupLocked || !assertionPickerSeed?.isConnected) return;
      emitExactAssertionSelection(assertionPickerSeed);
    });
    const back = document.createElement("button");
    back.type = "button";
    back.className = "text-action";
    back.textContent = "Continue picking";
    back.hidden = !assertionGroupLocked;
    back.addEventListener("click", () => {
      assertionGroupLocked = false;
      assertionFrozenGroup = null;
      assertionPickerSeed = null;
      assertionGroupCandidates = [];
      assertionSelectedGroupIndex = null;
      clearAssertionHighlight();
      renderAssertionPickerPanel();
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "text-action cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      if (!assertionPickerRequestId) return;
      const requestId = assertionPickerRequestId;
      window.__browserMemorySetAssertionPicker(null);
      emit({ type: "assertion-picker.cancelled", requestId });
    });
    actions.append(use, exact, back, cancel);
    content.append(actions);
  };

  const refreshAssertionGroups = () => {
    if (!assertionPickerRequestId) return;
    if (assertionGroupLocked && assertionFrozenGroup) {
      assertionFrozenGroup = repeatedGroupFor(assertionFrozenGroup.parent, assertionFrozenGroup.templateDescription);
      assertionGroupCandidates = [assertionFrozenGroup];
      assertionSelectedGroupIndex = 0;
      if (assertionFrozenGroup.members.length) highlightAssertionTargets(assertionFrozenGroup.members, "#285bd6");
      else clearAssertionHighlight();
      renderAssertionPickerPanel();
      return;
    }
    if (!assertionPickerSeed?.isConnected) {
      assertionPickerSeed = null;
      assertionGroupCandidates = [];
      assertionSelectedGroupIndex = null;
      clearAssertionHighlight();
      renderAssertionPickerPanel();
      return;
    }
    assertionGroupCandidates = discoverRepeatedGroups(assertionPickerSeed);
    assertionSelectedGroupIndex = assertionGroupCandidates.length ? 0 : null;
    if (assertionSelectedGroupIndex === null) highlightAssertionTarget(assertionPickerSeed);
    else highlightAssertionTargets(assertionGroupCandidates[assertionSelectedGroupIndex].members, "#285bd6");
    renderAssertionPickerPanel();
  };

  const mountAssertionPickerPanel = () => {
    const host = document.createElement("div");
    host.setAttribute("data-browser-memory-assertion-ui", "");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("top", "16px", "important");
    host.style.setProperty("right", "16px", "important");
    host.style.setProperty("width", "min(320px, calc(100vw - 32px))", "important");
    host.style.setProperty("max-height", "calc(100vh - 32px)", "important");
    host.style.setProperty("z-index", "2147483647", "important");
    host.style.setProperty("pointer-events", "auto", "important");
    host.style.setProperty("display", assertionPickerPanelActive ? "block" : "none", "important");
    const root = host.attachShadow({ mode: "open", delegatesFocus: true });
    const style = document.createElement("style");
    style.textContent = [
      ":host{all:initial}",
      "*{box-sizing:border-box}",
      ".panel{max-height:calc(100vh - 32px);padding:20px;background:#fff;color:#172033;border:1px solid #d8e1ef;border-radius:14px;box-shadow:0 18px 44px rgba(15,35,75,.20);font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;overflow:auto}",
      ".eyebrow{font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#285bd6;margin:0 0 14px}",
      "h2{font-size:20px;line-height:1.25;margin:0;color:#172033}",
      ".match-summary{display:flex;align-items:center;gap:8px;margin:10px 0 0;color:#526079;font-size:13px}",
      ".match-marker{width:22px;height:22px;display:grid;place-items:center;flex:0 0 auto;border-radius:999px;color:#fff;background:#285bd6;font-size:13px;font-weight:800}",
      ".guidance{color:#5e6b82;margin:14px 0 16px;font-size:13px;line-height:1.5}",
      ".group-list{display:grid;gap:8px}",
      ".group-row{width:100%;display:grid;gap:3px;text-align:left;border:1px solid #d8e1ef;border-radius:10px;padding:12px;background:#fff;color:#172033;cursor:pointer}",
      ".group-row span{font-size:12px;color:#647087}",
      ".group-row:hover,.group-row:focus-visible{border-color:#285bd6;outline:3px solid rgba(40,91,214,.20);outline-offset:1px}",
      ".group-row.selected{border-color:#8fb0f5;background:#eef4ff}",
      "details{margin-top:14px;border-top:1px solid #e5ebf3;padding-top:12px;color:#354158}",
      "summary{cursor:pointer;font-size:12px;font-weight:700}",
      "summary:focus-visible{outline:3px solid rgba(40,91,214,.20);outline-offset:3px;border-radius:3px}",
      "pre{max-height:180px;white-space:pre-wrap;overflow:auto;overflow-wrap:anywhere;padding:10px;border-radius:8px;background:#f4f7fb;color:#3f4b61;font:11px/1.45 ui-monospace,SFMono-Regular,monospace}",
      ".actions{display:grid;gap:8px;margin-top:18px}",
      ".actions button{min-height:40px;border:1px solid #cfd9e8;border-radius:8px;background:#fff;color:#26344d;font:700 13px/1 ui-sans-serif,system-ui,sans-serif;cursor:pointer}",
      ".actions button:hover:not(:disabled){border-color:#9eb4d8;background:#f7f9fc}",
      ".actions button:focus-visible{outline:3px solid rgba(40,91,214,.24);outline-offset:2px}",
      ".actions .primary{border-color:#285bd6;background:#285bd6;color:#fff}",
      ".actions .primary:hover:not(:disabled){border-color:#204db9;background:#204db9}",
      ".actions .text-action{min-height:36px;border-color:transparent;background:transparent;color:#285bd6}",
      ".actions .text-action:hover:not(:disabled){border-color:transparent;background:#eef4ff}",
      ".actions .cancel{color:#526079}",
      ".actions button:disabled{cursor:not-allowed;opacity:.45}",
      "[hidden]{display:none!important}",
    ].join("");
    const panel = document.createElement("aside");
    panel.className = "panel";
    panel.setAttribute("aria-label", "Repeated group assertion picker");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Assertion picker";
    const content = document.createElement("div");
    content.setAttribute("data-content", "");
    panel.append(eyebrow, content);
    root.append(style, panel);
    document.documentElement.append(host);
    assertionPickerPanelHost = host;
    renderAssertionPickerPanel();
    assertionGroupObserver = new MutationObserver(() => {
      if (assertionGroupRefreshFrame !== null) return;
      assertionGroupRefreshFrame = requestAnimationFrame(() => {
        assertionGroupRefreshFrame = null;
        refreshAssertionGroups();
      });
    });
    if (document.body) assertionGroupObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "aria-hidden", "role"],
    });
  };

  const visibleLabelFor = (element) => {
    const labels = new Set(element.labels ? [...element.labels] : []);
    const wrapping = element.closest("label");
    if (wrapping) labels.add(wrapping);
    return displayLabelText([...labels].filter(isVisible).map(labelText).join(" "));
  };

  const labelledByName = (element) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (!labelledBy) return "";
    const root = element.getRootNode?.();
    const value = labelledBy.split(/\s+/).map((id) => root?.getElementById?.(id)?.textContent || document.getElementById(id)?.textContent || "").join(" ");
    return displayLabelText(value);
  };

  const isFieldControl = (element) => {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
    if (!(element instanceof HTMLInputElement)) return false;
    return !["button", "submit", "reset", "image", "file", "hidden"].includes(element.type);
  };

  const isHelperText = (element) => {
    const identity = [element.id, element.className, element.getAttribute("role")].join(" ");
    return element.matches("small,[aria-live],[role='alert'],[role='status'],[role='note']") ||
      /(help|hint|error|invalid|validation|description|message|feedback)/i.test(identity);
  };

  const structuralLabelFor = (field) => {
    const interactive = "input,textarea,select,button,a[href],[role='button'],[contenteditable='true']";
    let branch = field;

    for (let depth = 0; depth < 2; depth++) {
      const container = branch.parentElement;
      if (!container || container === document.body || container === document.documentElement) break;
      const controls = [...container.querySelectorAll("input,textarea,select")].filter(isFieldControl);

      if (controls.length === 1 && controls[0] === field) {
        let sibling = branch.previousElementSibling;
        while (sibling) {
          const labels = sibling.matches("label") ? [sibling] : [...sibling.querySelectorAll("label")].reverse();
          for (const label of labels) {
            if (!isVisible(label) || isHelperText(label) || label.querySelector(interactive)) continue;
            if (label.htmlFor || (label.control && label.control !== field)) continue;
            const text = displayLabelText(labelText(label));
            if (text) return text;
          }
          sibling = sibling.previousElementSibling;
        }
      }

      branch = container;
    }

    return "";
  };

  const inferredLabelAbove = (field) => {
    const fieldRect = field.getBoundingClientRect();
    if (fieldRect.width <= 0 || fieldRect.height <= 0) return "";
    const interactive = "input,textarea,select,button,a[href],[role='button'],[contenteditable='true']";
    let best = null;
    let anchor = field;

    for (let depth = 0; depth < 2; depth++) {
      let sibling = anchor.previousElementSibling;
      while (sibling) {
        const candidates = [sibling, ...sibling.querySelectorAll("label,span,div,p,strong,legend")];
        for (const candidate of candidates) {
          if (!isVisible(candidate) || isHelperText(candidate) || candidate.matches(interactive) || candidate.querySelector(interactive)) continue;
          const text = displayLabelText(candidate.innerText);
          if (!text) continue;
          const rect = candidate.getBoundingClientRect();
          const gap = fieldRect.top - rect.bottom;
          if (gap < 0 || gap > 16) continue;
          const overlap = Math.max(0, Math.min(fieldRect.right, rect.right) - Math.max(fieldRect.left, rect.left));
          const narrowerWidth = Math.min(fieldRect.width, rect.width);
          const overlapRatio = narrowerWidth > 0 ? overlap / narrowerWidth : 0;
          if (overlapRatio < 0.5) continue;
          const area = rect.width * rect.height;
          if (!best || gap < best.gap || (gap === best.gap && overlapRatio > best.overlapRatio) || (gap === best.gap && overlapRatio === best.overlapRatio && area < best.area)) {
            best = { text, gap, overlapRatio, area };
          }
        }
        sibling = sibling.previousElementSibling;
      }
      const parent = anchor.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      anchor = parent;
    }

    return best?.text || "";
  };

  const fieldDisplayName = (element) => {
    if (!isFieldControl(element)) return "";
    const label = visibleLabelFor(element);
    if (label) return label;
    const labelledBy = labelledByName(element);
    if (labelledBy) return labelledBy;
    const aria = clip(element.getAttribute("aria-label") || "");
    if (aria) return aria;
    const structural = structuralLabelFor(element);
    if (structural) return structural;
    const inferred = inferredLabelAbove(element);
    if (inferred) return inferred;
    const hint = clip(element.getAttribute("placeholder") || element.getAttribute("title") || "");
    if (hint) return hint;
    return fieldIdentityName(element);
  };

  const humanizeFieldIdentity = (value) => {
    const raw = normalize(value);
    if (!raw || raw.length > 120 || !/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(raw)) return "";
    if (/(^|[_.-])(input|textarea|select|field|control)([_.-]|$)/i.test(raw) && /\d/.test(raw)) return "";
    const humanized = normalize(raw
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_.-]+/g, " "));
    if (!humanized || /^(input|textarea|select|field|form field|control|value)$/i.test(humanized)) return "";
    const sentenceCase = humanized.toLowerCase();
    return sentenceCase.charAt(0).toUpperCase() + sentenceCase.slice(1);
  };

  const fieldIdentityName = (element) => {
    const autocomplete = normalize(element.getAttribute("autocomplete") || "").split(/\s+/).filter((token) =>
      token && !["on", "off", "shipping", "billing", "webauthn"].includes(token.toLowerCase()) && !token.toLowerCase().startsWith("section-"),
    ).at(-1) || "";
    for (const value of [autocomplete, element.getAttribute("name"), element.getAttribute("id"), element.getAttribute("formcontrolname")]) {
      const name = humanizeFieldIdentity(value);
      if (name) return name;
    }
    return "";
  };

  const unique = (selector) => {
    try { return document.querySelectorAll(selector).length === 1; } catch { return false; }
  };

  const cssPath = (element) => {
    if (element.id) return "#" + escapeCss(element.id);
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let part = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      const selector = parts.join(" > ");
      if (unique(selector)) return selector;
      current = parent;
    }
    return parts.length ? "body > " + parts.join(" > ") : "body";
  };

  const xpath = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(current.tagName.toLowerCase() + "[" + index + "]");
      current = current.parentElement;
    }
    return "/" + parts.join("/");
  };

  const describe = (element) => {
    const candidates = [];
    const testId = element.getAttribute("data-testid");
    const role = element.getAttribute("role") || implicitRole(element);
    const name = accessibleName(element);
    const label = labelFor(element);
    const text = clip(element.innerText || element.textContent || "");
    if (testId) candidates.push({ kind: "testId", value: testId, exact: true, unique: document.querySelectorAll('[data-testid="' + escapeCss(testId) + '"]').length === 1 });
    if (role && name) candidates.push({ kind: "role", value: role, name, exact: true });
    if (name) candidates.push({ kind: "accessibleName", value: name, exact: true });
    if (label && label !== name) candidates.push({ kind: "label", value: label, exact: true });
    if (text && text !== name && text.length <= 120) candidates.push({ kind: "text", value: text, exact: true });
    const css = cssPath(element);
    candidates.push({ kind: "css", value: css, exact: true, unique: unique(css) });
    candidates.push({ kind: "xpath", value: xpath(element), exact: true });
    return {
      tagName: element.tagName.toLowerCase(),
      inputType: element instanceof HTMLInputElement ? element.type : undefined,
      frameUrl: window === window.top ? undefined : location.href,
      candidates,
    };
  };

  const targetName = (element) => {
    const fieldName = fieldDisplayName(element);
    if (fieldName) return fieldName;
    const name = accessibleName(element);
    return name || element.tagName.toLowerCase();
  };

  const emitExactAssertionSelection = (element) => {
    if (!assertionPickerRequestId || !(element instanceof HTMLElement)) return;
    const requestId = assertionPickerRequestId;
    window.__browserMemorySetAssertionPicker(null);
    emit({
      type: "assertion-picker.selected",
      requestId,
      name: targetName(element),
      text: clip(element.innerText || "", ${MAX_ASSERTION_TEXT_LENGTH}),
      target: describe(element),
      position: viewportPosition(),
    });
  };

  const sensitive = (element) => {
    const type = element.getAttribute("type") || "";
    const autocomplete = element.getAttribute("autocomplete") || "";
    const identity = [type, autocomplete, element.getAttribute("name"), element.getAttribute("id"), accessibleName(element)].join(" ");
    return /(password|current-password|new-password|one-time-code|cc-|credit|card|token|secret)/i.test(identity);
  };

  const isEditableField = (element) => {
    if (element instanceof HTMLTextAreaElement || element.isContentEditable) return true;
    if (!(element instanceof HTMLInputElement)) return false;
    return !["button", "submit", "reset", "image", "checkbox", "radio", "file", "hidden", "date"].includes(element.type);
  };

  const semanticClickSelector = [
    "button",
    "a[href]",
    "[role='button']",
    "[role='link']",
    "[role='menuitem']",
    "[role='menuitemcheckbox']",
    "[role='menuitemradio']",
    "[role='option']",
    "[role='tab']",
    "input[type='button']",
    "input[type='submit']",
    "input[type='reset']",
    "input[type='image']",
    "input[type='checkbox']",
    "input[type='radio']",
  ].join(",");

  const nativeSelectForInteraction = (element) => {
    const direct = element.closest("select");
    if (direct instanceof HTMLSelectElement) return direct;
    const label = element instanceof HTMLLabelElement ? element : element.closest("label");
    return label?.control instanceof HTMLSelectElement ? label.control : null;
  };

  const isFocusOnlyControl = (element) => {
    const control = element.closest("input,textarea,[contenteditable]");
    if (!control) return false;
    if (control instanceof HTMLInputElement) {
      return !["button", "submit", "reset", "image", "checkbox", "radio"].includes(control.type);
    }
    return true;
  };

  const resolveClickTarget = (event) => {
    const origin = eventElement(event);
    if (!origin) return null;

    const select = nativeSelectForInteraction(origin);
    if (select) return select;
    if (isFocusOnlyControl(origin)) return null;

    const semantic = origin.closest(semanticClickSelector);
    if (semantic instanceof HTMLElement) return semantic;

    const path = event.composedPath().filter((item) => item instanceof HTMLElement);
    const content = path.filter((element) =>
      element !== document.body &&
      element !== document.documentElement &&
      !isFocusOnlyControl(element)
    );
    const signaled = content.find((element) =>
      typeof element.onclick === "function" ||
      element.hasAttribute("onclick") ||
      element.tabIndex >= 0 ||
      getComputedStyle(element).cursor === "pointer"
    );
    return signaled || content[0] || null;
  };

  const resolveEnterTarget = (event) => {
    const element = eventElement(event);
    if (!(element instanceof HTMLElement)) return null;
    if (element instanceof HTMLTextAreaElement || element.isContentEditable) return null;
    if (element instanceof HTMLSelectElement) return null;
    if (element instanceof HTMLInputElement && element.type === "date") return null;
    if (isEditableField(element)) return element;
    const target = element.closest(semanticClickSelector);
    return target instanceof HTMLElement ? target : null;
  };

  const flushInput = (element) => {
    if (!dirtyFields.has(element)) return;
    dirtyFields.delete(element);
    let value = "";
    if ("value" in element) value = element.value;
    else value = element.textContent || "";
    emitAction({ type: "fill", name: targetName(element), target: describe(element), payload: { value }, sensitive: sensitive(element) });
  };

  const isOptionLikeClick = (element) =>
    element instanceof HTMLOptionElement ||
    Boolean(element.closest("[role='option'],[role='menuitemradio']"));

  const flushPendingOptionClick = () => {
    if (!pendingOptionClick) return;
    clearTimeout(pendingOptionClick.timer);
    const action = pendingOptionClick.action;
    pendingOptionClick = null;
    emitAction(action);
  };

  const holdOptionClick = (action, label) => {
    flushPendingOptionClick();
    const timer = setTimeout(() => flushPendingOptionClick(), 300);
    pendingOptionClick = { action, label: normalize(label).toLocaleLowerCase(), timer };
  };

  const cancelMatchingOptionClick = (label) => {
    if (!pendingOptionClick) return;
    if (pendingOptionClick.label !== normalize(label).toLocaleLowerCase()) {
      flushPendingOptionClick();
      return;
    }
    clearTimeout(pendingOptionClick.timer);
    pendingOptionClick = null;
  };

  const recordControlChange = (element) => {
    const select = nativeSelectForInteraction(element);
    if (!select || select.multiple) return false;
    selectPickerOpen = false;
    const selectedOption = select.selectedOptions[0];
    const label = selectedOption ? clip(selectedOption.label || selectedOption.textContent || "") : "";
    cancelMatchingOptionClick(label);
    if (window.__browserMemorySuppressSelectChange) return true;
    [...dirtyFields].forEach((field) => flushInput(field));
    emitAction({
      type: "select",
      name: targetName(select),
      target: describe(select),
      payload: { value: select.value, ...(label ? { label } : {}) },
      sensitive: sensitive(select),
    });
    return true;
  };

  window.addEventListener("input", (event) => {
    if (window.__browserMemoryCaptchaLocked) return;
    const element = eventElement(event);
    if (element instanceof HTMLInputElement && element.type === "date") {
      datePickerOpen = false;
      return;
    }
    if (!(element instanceof HTMLElement) || !isEditableField(element)) return;
    dirtyFields.add(element);
  }, true);

  window.addEventListener("focusout", (event) => {
    if (window.__browserMemoryCaptchaLocked) return;
    const element = eventElement(event);
    if (element instanceof HTMLElement) flushInput(element);
  }, true);

  window.addEventListener("change", (event) => {
    if (window.__browserMemoryCaptchaLocked) return;
    const element = eventElement(event);
    if (element instanceof HTMLElement) recordControlChange(element);
  }, true);

  window.addEventListener("pointerover", (event) => {
    if (!assertionPickerRequestId || assertionGroupLocked || isAssertionPickerUiEvent(event)) return;
    if (!assertionPickerPanelActive) activateCurrentAssertionPickerFrame();
    const element = assertionEventElement(event);
    if (!(element instanceof HTMLElement) || element === document.body || element === document.documentElement) return;
    assertionPickerSeed = element;
    refreshAssertionGroups();
  }, true);

  window.addEventListener("pointerout", (event) => {
    if (!assertionPickerRequestId || assertionGroupCandidates.length || assertionPickerHighlights[0]?.element !== assertionEventElement(event)) return;
    const next = event.relatedTarget;
    if (next instanceof Node && assertionPickerHighlights[0].element.contains(next)) return;
    clearAssertionHighlight();
  }, true);

  window.addEventListener("click", (event) => {
    if (!assertionPickerRequestId || isAssertionPickerUiEvent(event)) return;
    const element = assertionEventElement(event);
    if (!(element instanceof HTMLElement)) return;
    const previewedGroup = assertionSelectedGroupIndex === null ? null : assertionGroupCandidates[assertionSelectedGroupIndex];
    const clickedPreviewedMember = previewedGroup?.members.some((member) => member === element || member.contains(element));
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (!assertionGroupLocked && clickedPreviewedMember) {
      assertionPickerSeed = element;
      freezeAssertionGroup(assertionSelectedGroupIndex);
      return;
    }
    if (assertionGroupLocked) return;
    emitExactAssertionSelection(element);
  }, true);

  window.addEventListener("keydown", (event) => {
    if (!assertionPickerRequestId || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const requestId = assertionPickerRequestId;
    window.__browserMemorySetAssertionPicker(null);
    emit({ type: "assertion-picker.cancelled", requestId });
  }, true);

  window.addEventListener("click", (event) => {
    if (window.__browserMemoryCaptchaLocked || isAssertionPickerUiEvent(event)) return;
    if (suppressKeyboardClick && event.detail === 0) {
      suppressKeyboardClick = false;
      if (suppressKeyboardClickTimer) clearTimeout(suppressKeyboardClickTimer);
      suppressKeyboardClickTimer = null;
      return;
    }
    const origin = eventElement(event);
    const select = origin ? nativeSelectForInteraction(origin) : null;
    if (select instanceof HTMLSelectElement && !select.disabled && !select.multiple && select.size <= 1) {
      if (window.__browserMemoryNativeSelects) {
        if (datePickerOpen) {
          datePickerOpen = false;
          emit({ type: "date-picker.dismiss" });
        }
        selectPickerOpen = false;
        return;
      }
      event.preventDefault();
      if (datePickerOpen) {
        datePickerOpen = false;
        emit({ type: "date-picker.dismiss" });
      }
      if (selectPickerOpen) emit({ type: "select-picker.dismiss" });
      selectPickerOpen = true;
      const rect = select.getBoundingClientRect();
      emitAction({
        type: "select-picker.request",
        selector: cssPath(select),
        name: targetName(select),
        target: describe(select),
        value: select.value,
        options: [...select.options].map((option) => ({
          value: option.value,
          label: clip(option.label || option.textContent || ""),
          disabled: option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled),
        })),
        sensitive: sensitive(select),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });
      return;
    }
    const dateInput = origin
      ? origin.closest('input[type="date"]')
      : null;
    if (dateInput instanceof HTMLInputElement) {
      event.preventDefault();
      datePickerOpen = true;
      const rect = dateInput.getBoundingClientRect();
      emitAction({
        type: "date-picker.request",
        selector: cssPath(dateInput),
        name: targetName(dateInput),
        target: describe(dateInput),
        value: dateInput.value,
        min: dateInput.min,
        max: dateInput.max,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });
      return;
    }

    if (datePickerOpen) {
      datePickerOpen = false;
      emit({ type: "date-picker.dismiss" });
    }
    if (selectPickerOpen) {
      selectPickerOpen = false;
      emit({ type: "select-picker.dismiss" });
    }
    const element = resolveClickTarget(event);
    if (!(element instanceof HTMLElement)) return;
    [...dirtyFields].forEach((field) => flushInput(field));
    const action = { type: "click", name: targetName(element), target: describe(element), sensitive: false };
    if (isOptionLikeClick(element)) {
      holdOptionClick(action, action.name);
      return;
    }
    flushPendingOptionClick();
    emitAction(action);
  }, true);

  window.addEventListener("keydown", (event) => {
    if (window.__browserMemoryCaptchaLocked || isAssertionPickerUiEvent(event)) return;
    if (event.key === "Escape" && datePickerOpen) {
      datePickerOpen = false;
      emit({ type: "date-picker.dismiss" });
    }
    if (event.key === "Escape" && selectPickerOpen) {
      selectPickerOpen = false;
      emit({ type: "select-picker.dismiss" });
    }
    if (event.key !== "Enter" || event.isComposing) return;
    const element = resolveEnterTarget(event);
    if (!element) return;
    suppressKeyboardClick = true;
    if (suppressKeyboardClickTimer) clearTimeout(suppressKeyboardClickTimer);
    suppressKeyboardClickTimer = setTimeout(() => {
      suppressKeyboardClick = false;
      suppressKeyboardClickTimer = null;
    }, 0);
    if (event.repeat) return;
    flushInput(element);
    const modifiers = [
      event.altKey ? "Alt" : null,
      event.ctrlKey ? "Control" : null,
      event.metaKey ? "Meta" : null,
      event.shiftKey ? "Shift" : null,
    ].filter(Boolean);
    emitAction({
      type: "keypress",
      name: targetName(element),
      target: describe(element),
      payload: { key: "Enter", modifiers },
      sensitive: false,
    });
  }, true);

  window.addEventListener("scroll", () => {
    if (window.__browserMemoryCaptchaLocked) return;
    if (!selectPickerOpen) return;
    selectPickerOpen = false;
    emit({ type: "select-picker.dismiss" });
  }, true);
})();`;

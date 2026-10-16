type CandidateProfile = {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  experience_years?: number | string | null;
};

export function getCopilotScriptText(profile: CandidateProfile): string {
  // JSON data embedded in an HTML script context must escape script-closing characters.
  // Replacing '<' means a profile value like </script> remains literal JS data.
  const vault = JSON.stringify({
    full_name: profile?.full_name ?? '',
    email: profile?.email ?? '',
    phone: profile?.phone ?? '',
    experience_years: profile?.experience_years ?? '',
  })
    .replace(/</g, '\\u003c')
    .replace(/[\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16)}`);

  return String.raw`<script>
(function () {
  'use strict';
  if (window.__nichehireActive) return;
  window.__nichehireActive = true;

  var vault = ${vault};
  var voiceOn = false;
  var lang = 'en-US';
  var started = false;
  var dict = {
    'en-US': {
      start: 'NicheHire Co-Pilot is ready. Review all information before submitting.',
      complete: 'Field updated. Please verify the information.',
      alert: 'This value differs from your profile. Review it before correcting it.'
    },
    'hi-IN': {
      start: 'निशहायर को-पायलट तैयार है। आवेदन जमा करने से पहले जानकारी जांचें।',
      complete: 'फ़ील्ड अपडेट हो गया है। कृपया जानकारी की पुष्टि करें।',
      alert: 'यह जानकारी आपकी प्रोफ़ाइल से अलग है। सुधारने से पहले जांचें।'
    },
    'mr-IN': {
      start: 'निशहायर को-पायलट तयार आहे. अर्ज सबमिट करण्यापूर्वी माहिती तपासा.',
      complete: 'फील्ड अपडेट झाले आहे. कृपया माहिती तपासा.',
      alert: 'ही माहिती तुमच्या प्रोफाइलपेक्षा वेगळी आहे. दुरुस्ती करण्यापूर्वी तपासा.'
    }
  };

  function speak(key) {
    if (!voiceOn || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      var utterance = new SpeechSynthesisUtterance((dict[lang] || dict['en-US'])[key]);
      utterance.lang = lang;
      window.speechSynthesis.speak(utterance);
    } catch (_) {}
  }

  function normalise(value) {
    return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function labelText(el) {
    var result = '';
    if (el.id) {
      try {
        var label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (label) result += ' ' + (label.innerText || label.textContent || '');
      } catch (_) {}
    }
    var wrappingLabel = el.closest ? el.closest('label') : null;
    if (wrappingLabel) result += ' ' + (wrappingLabel.innerText || wrappingLabel.textContent || '');
    var labelIds = el.getAttribute('aria-labelledby');
    if (labelIds) labelIds.split(/\s+/).forEach(function (id) {
      var node = document.getElementById(id);
      if (node) result += ' ' + (node.innerText || node.textContent || '');
    });
    if (el.labels) Array.prototype.forEach.call(el.labels, function (node) {
      result += ' ' + (node.innerText || node.textContent || '');
    });
    return result;
  }

  function contextOf(el) {
    return [el.name, el.id, el.placeholder, el.getAttribute('aria-label'),
      el.getAttribute('autocomplete'), labelText(el)].filter(Boolean).join(' ').toLowerCase();
  }

  var nameParts = String(vault.full_name || '').trim().split(/\s+/).filter(Boolean);
  var rules = [
    { ac: 'given-name', re: /(first[\s_-]*name|given[\s_-]*name|fname|forename)/, value: nameParts[0] || '' },
    { ac: 'family-name', re: /(last[\s_-]*name|sur[\s_-]*name|family[\s_-]*name|lname)/, value: nameParts.length > 1 ? nameParts.slice(1).join(' ') : '' },
    { ac: 'name', re: /(full[\s_-]*name|your[\s_-]*name|candidate[\s_-]*name|applicant[\s_-]*name)/, value: vault.full_name || '' },
    { ac: 'email', re: /(e[\s_-]?mail)/, value: vault.email || '' },
    { ac: 'tel', re: /(phone|mobile|telephone|contact[\s_-]*(no|number))/ , value: vault.phone || '' },
    { ac: '', re: /(years[\s_-]*of[\s_-]*experience|experience[\s_-]*(in[\s_-]*)?years|total[\s_-]*experience|work[\s_-]*exp)/, value: vault.experience_years }
  ];
  var skipTypes = ['hidden', 'submit', 'button', 'reset', 'image', 'file', 'checkbox', 'radio', 'password'];

  function matchRule(el, ctx) {
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    for (var i = 0; i < rules.length; i++) if (rules[i].ac && rules[i].ac === ac) return rules[i];
    for (var j = 0; j < rules.length; j++) if (rules[j].re.test(ctx)) return rules[j];
    return null;
  }

  function visible(el) {
    return !!(el.offsetParent || (el.getClientRects && el.getClientRects().length));
  }

  function required(el) {
    return !!el.required || el.getAttribute('aria-required') === 'true' || labelText(el).indexOf('*') !== -1;
  }

  function setValue(el, value) {
    var proto;
    if (el instanceof HTMLTextAreaElement) proto = HTMLTextAreaElement.prototype;
    else if (el instanceof HTMLSelectElement) proto = HTMLSelectElement.prototype;
    else proto = HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    el.__nhSetting = true;
    if (descriptor && descriptor.set) descriptor.set.call(el, String(value));
    else el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.__nhSetting = false;
  }

  function applyStyle(el, border, background) {
    el.style.outline = border;
    el.style.backgroundColor = background;
  }

  function removeBubble(el) {
    if (el.__nhBubble && el.__nhBubble.parentNode) el.__nhBubble.parentNode.removeChild(el.__nhBubble);
    el.__nhBubble = null;
  }

  function showBubble(el, text, handler) {
    removeBubble(el);
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.style.cssText = 'display:block;margin:4px 0;background:#1d4ed8;color:#fff;font:600 12px sans-serif;padding:6px 9px;border-radius:5px;border:0;cursor:pointer;max-width:100%;white-space:normal;text-align:left;';
    button.addEventListener('click', function (event) { event.preventDefault(); handler(); });
    el.insertAdjacentElement('afterend', button);
    el.__nhBubble = button;
  }

  function fieldLabel(el) {
    return (labelText(el).replace(/\*/g, '').trim() || el.placeholder || el.name || 'this field').slice(0, 80);
  }

  function markMissing(el) {
    applyStyle(el, '2px solid #ef4444', '');
    showBubble(el, 'Required field: ' + fieldLabel(el), function () { el.focus(); });
  }

  function addCorrectionWatcher(el, expected) {
    el.addEventListener('change', function () {
      if (el.__nhSetting) return;
      if (String(el.value) !== String(expected)) {
        applyStyle(el, '2px solid #f59e0b', '#fffbeb');
        speak('alert');
        showBubble(el, 'Profile value differs. Click to use: ' + expected, function () {
          setValue(el, expected);
          applyStyle(el, '2px solid #10b981', '#ecfdf5');
          speak('complete');
          removeBubble(el);
        });
      } else {
        applyStyle(el, '2px solid #10b981', '#ecfdf5');
        removeBubble(el);
      }
    });
  }

  function auditField(el) {
    if (el.__nhDone) return;
    var tag = el.tagName;
    var type = (el.type || 'text').toLowerCase();
    if (tag === 'INPUT' && skipTypes.indexOf(type) !== -1) return;
    if (el.disabled || el.readOnly || !visible(el)) return;
    el.__nhDone = true;

    var rule = matchRule(el, contextOf(el));
    if (rule) {
      var value = rule.value == null ? '' : String(rule.value).trim();
      if (!value) {
        if (!String(el.value || '').trim()) markMissing(el);
        return;
      }

      if (tag === 'SELECT') {
        var options = Array.prototype.slice.call(el.options || []);
        var expectedOption = options.find(function (option) {
          return normalise(option.value) === normalise(value) || normalise(option.textContent) === normalise(value);
        });
        if (!expectedOption) {
          // Do not pick an approximate or incorrect select option.
          if (required(el) && !el.value) markMissing(el);
          return;
        }
        if (!el.value) {
          setValue(el, expectedOption.value);
          applyStyle(el, '2px solid #10b981', '#ecfdf5');
        }
        return;
      }

      if (!String(el.value || '').trim()) {
        setValue(el, value);
        applyStyle(el, '2px solid #10b981', '#ecfdf5');
        addCorrectionWatcher(el, value);
      }
      // Existing values are intentionally never overwritten automatically.
      return;
    }

    if (required(el) && !String(el.value || '').trim()) markMissing(el);
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    var fields = root.querySelectorAll('input, textarea, select');
    for (var i = 0; i < fields.length; i++) auditField(fields[i]);
    if (root.matches && root.matches('input, textarea, select')) auditField(root);
  }

  function start() {
    if (started) return;
    started = true;
    scan(document);
    speak('start');
    var timer = null;
    new MutationObserver(function (records) {
      var shouldScan = false;
      records.forEach(function (record) {
        if (record.addedNodes && record.addedNodes.length) shouldScan = true;
      });
      if (!shouldScan) return;
      clearTimeout(timer);
      timer = setTimeout(function () { scan(document); }, 250);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // Do not speak or start filling until the parent toolbar sends its current settings.
  // A sandboxed srcDoc has an opaque origin, so the parent uses '*' as targetOrigin;
  // source validation plus strict message-shape checks limit accepted messages.
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.type !== 'NICHEHIRE_SETTINGS_UPDATE') return;
    if (typeof data.language === 'string' && dict[data.language]) lang = data.language;
    if (typeof data.voiceOn !== 'boolean') return;
    voiceOn = data.voiceOn;
    if (!voiceOn && window.speechSynthesis) window.speechSynthesis.cancel();
    start();
  });
})();
</script>`;
}

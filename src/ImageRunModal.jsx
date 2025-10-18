import React from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form";
import { FormHelper } from "cockpit-components-form-helper.jsx";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect";
import { Grid, GridItem } from "@patternfly/react-core/dist/esm/layouts/Grid";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal";
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio";
import { Select, SelectGroup, SelectOption, SelectVariant } from "@patternfly/react-core/dist/esm/deprecated/components/Select";
import { NumberInput } from "@patternfly/react-core/dist/esm/components/NumberInput";
import { InputGroup, InputGroupText } from "@patternfly/react-core/dist/esm/components/InputGroup";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput";
import { Tab, TabTitleText, Tabs } from "@patternfly/react-core/dist/esm/components/Tabs";
import { Text } from "@patternfly/react-core/dist/esm/components/Text";
import { ToggleGroup, ToggleGroupItem } from "@patternfly/react-core/dist/esm/components/ToggleGroup";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover";
import { OutlinedQuestionCircleIcon } from '@patternfly/react-icons';
import * as dockerNames from 'docker-names';

import { ErrorNotification } from './Notification.jsx';
import * as utils from './util.js';
import * as client from './client.js';
import rest from './rest.js';
import cockpit from 'cockpit';
import { onDownloadContainer, onDownloadContainerFinished } from './Containers.jsx';
import { PublishPort, validatePublishPort } from './PublishPort.jsx';
import { DynamicListForm } from './cockpit-components-dynamic-list.jsx';
import { validateVolume, Volume } from './Volume.jsx';
import { EnvVar, validateEnvVar } from './Env.jsx';
import { TextArea } from "@patternfly/react-core/dist/esm/components/TextArea";
import { debounce } from 'throttle-debounce';

import "./ImageRunModal.scss";

const _ = cockpit.gettext;

const units = {
  KB: { name: "KB", baseExponent: 1 },
  MB: { name: "MB", baseExponent: 2 },
  GB: { name: "GB", baseExponent: 3 },
};

// healthchecks.go HealthCheckOnFailureAction
const HealthCheckOnFailureActionOrder = [
  { value: 0, label: _("No action") },
  { value: 3, label: _("Restart") },
  { value: 4, label: _("Stop") },
  { value: 2, label: _("Force stop") },
];

// ---- GHCR helpers (versa-node) ----
const GHCR_NAMESPACE = "ghcr.io/versa-node/";
const isGhcrVersaNodeTerm = (term) =>
  /^ghcr\.io\/versa-node\/[^/]+/i.test(term || "") || /^versa-node\/[^/]+/i.test(term || "");
const buildGhcrVersaNodeName = (txt) => {
  const t = (txt || "").trim()
    .replace(/^ghcr\.io\/?/i, "")
    .replace(/^versa-node\/?/i, "");
  return (GHCR_NAMESPACE + t).replace(/\/+$/, "");
};

// Normalize helpers
const DEFAULT_README_PATH = "/usr/share/versanode/README.md";
const addLatestIfMissing = (n) => (n && !/:[^/]+$/.test(n) ? `${n}:latest` : n);
const stripDockerIo = (n) => (n || "").replace(/^docker\.io\//i, "");
const toCanonicalName = (n) => addLatestIfMissing(stripDockerIo(n || ""));

// tiny logger
function dbg(...args) {
  if (window.debugging === "all" || (window.debugging || "").includes("readme") || (window.debugging || "").includes("vncp"))
    console.debug("[ImageRunModal]", ...args);
}



function starterNginxBlock() {
  return (
`location = \${PATH} { return 308 \${PATH}/; }
location ^~ \${PATH}/ {
    rewrite ^\${PATH}/(.*)$ /$1 break;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass \${UPSTREAM};
}`
  );
}

/* ---------------- small README renderer ---------------- */

function Inline({ text }) {
  const tokens = [];
  let i = 0;
  const rx = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;
  let m;
  while ((m = rx.exec(text))) {
    const [full] = m;
    if (m.index > i) tokens.push(text.slice(i, m.index));
    if (m[1] && m[2]) {
      tokens.push(<a key={`a-${m.index}`} href={m[2]} target="_blank" rel="noopener noreferrer">{m[1]}</a>);
    } else if (m[3]) {
      tokens.push(<code key={`code-${m.index}`} className="pf-v5-c-code">{m[3]}</code>);
    } else if (m[4]) {
      tokens.push(<strong key={`b-${m.index}`}>{m[4]}</strong>);
    } else if (m[5]) {
      tokens.push(<em key={`i-${m.index}`}>{m[5]}</em>);
    } else if (m[6]) {
      tokens.push(<em key={`i2-${m.index}`}>{m[6]}</em>);
    }
    i = m.index + full.length;
  }
  if (i < text.length) tokens.push(text.slice(i));
  return <>{tokens}</>;
}
// ---- UTF-8 <-> Base64 helpers (browser + Node) ----
export function utf8ToB64(str) {
  // Browser path
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  // Node path
  // eslint-disable-next-line no-undef
  return Buffer.from(str, "utf8").toString("base64");
}

export function b64ToUtf8(b64) {
  // Browser path
  if (typeof window !== "undefined" && typeof window.atob === "function") {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  // Node path
  // eslint-disable-next-line no-undef
  return Buffer.from(b64, "base64").toString("utf8");
}


function Markdown({ source }) {
  const lines = (source || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let buf = [], list = null, fence = null;

  const flushParagraph = () => {
    if (buf.length) {
      const text = buf.join(" ").trim();
      if (text) out.push(<p key={`p-${out.length}`}><Inline text={text} /></p>);
      buf = [];
    }
  };
  const flushList = () => {
    if (list && list.items.length) {
      out.push(<ul key={`ul-${out.length}`}>{list.items.map((t, i) => <li key={`li-${out.length}-${i}`}><Inline text={t} /></li>)}</ul>);
    }
    list = null;
  };
  const flushFence = () => {
    if (fence) {
      out.push(<pre key={`pre-${out.length}`}><code>{fence.lines.join("\n")}</code></pre>);
      fence = null;
    }
  };

  for (const raw of lines) {
    const line = raw;
    if (fence) { if (/^```/.test(line)) flushFence(); else fence.lines.push(line); continue; }
    const fm = line.match(/^```(\w+)?\s*$/); if (fm) { flushParagraph(); flushList(); fence = { lang:"", lines:[] }; continue; }
    if (/^\s*$/.test(line)) { flushParagraph(); flushList(); continue; }
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) { flushParagraph(); flushList(); const H = `h${hm[1].length}`; out.push(React.createElement(H, { key:`h-${out.length}` }, <Inline text={hm[2].trim()} />)); continue; }
    const lm = line.match(/^\s*[-*+]\s+(.*)$/);
    if (lm) { flushParagraph(); if (!list) list = { items: [] }; list.items.push(lm[1]); continue; }
    buf.push(line.trim());
  }
  flushFence(); flushParagraph(); flushList();
  return <div className="pf-v5-c-content">{out}</div>;
}

/* ---------------- README from labels (b64, single or chunked) ---------------- */

// Replace $$ (escaped dollars) with $ when *loading* from labels
function normalizeLoadedNginxBlock(txt = "") {
  return txt.replace(/\$\$/g, "$");
}

function decodeB64Utf8(b64) {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch (e) {
    console.warn("README base64 decode failed:", e);
    return "";
  }
}

function readEmbeddedReadmeFromLabels(labels = {}) {
  const pfx = "io.versanode.vncp.readme";
  const enc = labels[`${pfx}.encoding`] || "";
  if (!enc.startsWith("b64")) return null;

  if (labels[`${pfx}.single`]) {
    return decodeB64Utf8(labels[`${pfx}.single`]);
  }
  const parts = parseInt(labels[`${pfx}.parts`] || "0", 10);
  if (parts > 0) {
    let joined = "";
    for (let i = 0; i < parts; i++) {
      const chunk = labels[`${pfx}.${i}`];
      if (typeof chunk !== "string") return null;
      joined += chunk;
    }
    return decodeB64Utf8(joined);
  }
  return null;
}

/* ---------------- name helpers ---------------- */

function pkgFromImageRef(ref = "") {
  const s = String(ref);
  const noDigest = s.split("@")[0];
  const noTag = noDigest.split(":")[0];
  const parts = noTag.replace(/^docker\.io\//i, "").split("/");
  const last = parts[parts.length - 1] || "";
  return last.trim();
}
function toKebab(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function makeAutoName(ref, labels = null) {
  const title = labels?.["org.opencontainers.image.title"];
  const base = toKebab((title && title.trim()) || pkgFromImageRef(ref) || "app");
  const rand = (dockerNames.getRandomName && dockerNames.getRandomName()) || "random";
  return `${base}-${rand}`;
}
const normalizeContainerName = (s) => String(s || "").replace(/^\/+/, "");

/* ---------------- parse helpers ---------------- */

function parseEnvVars(arr = []) {
  return arr.map(line => {
    const idx = line.indexOf("=");
    if (idx === -1) return { envKey: line, envValue: "" };
    return { envKey: line.slice(0, idx), envValue: line.slice(idx + 1) };
  });
}

function parseVolumes(volObj = {}) {
  return Object.keys(volObj || {}).map(containerPath => ({
    containerPath,
    hostPath: null,
    readOnly: false,
  }));
}

// parseExposedPorts({ "8080/tcp": {}, "9000/udp": {} }) -> rows
function parseExposedPorts(exposed = {}) {
  return Object.keys(exposed || {}).map(k => {
    const [port, proto] = k.split("/");
    return {
      IP: null,
      containerPort: port,
      hostPort: port,
      protocol: (proto || "tcp").toLowerCase(),
    };
  });
}
const nsToSec = (ns) => Math.max(0, Math.round((parseInt(ns || 0, 10) || 0) / 1e9));

/* ---------------- VNCP proxy mapping helpers ---------------- */

const VNCP_PFX = "io.versanode.vncp";


const wantHostNetworkFromLabels = (labels = {}) => {
  const v1 = (labels["io.versanode.vncp.network"] || "").toString().trim().toLowerCase();
  const v2 = (labels["io.versanode.vncp.host_network"] || "").toString().trim().toLowerCase();
  return v1 === "host" || v2 === "true" || v2 === "1" || v2 === "yes";
};


// slug validation
function validateSlug(v) {
  if (v == null || String(v).trim() === "") return _("Slug is required");
  const s = String(v).trim();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s)) return _("Use lowercase letters, digits, and dashes (must start/end with alphanumeric)");
  if (s.length > 64) return _("Slug is too long");
  return null;
}
function validateProxyPort(v) {
  return validatePublishPort(v, "containerPort");
}

function extractProxiesFromLabels(labels = {}, _exposed = {}) {
  const proxies = [];
  const raw = labels[`${VNCP_PFX}.proxies`];
  if (!raw) return proxies;

  try {
    const parsed = JSON.parse(String(raw).trim());

    const pushEntry = (slug, port, obj = {}) => {
      const rec = { slug, port };
      // Map nginx_block → nginxBlockText for the editor
      if (typeof obj.nginx_block === "string") {
        rec.nginxBlockText = obj.nginx_block;
      }
      // Preserve any other keys as extra (optional)
      const { nginx_block, ...rest } = obj;
      if (Object.keys(rest).length) {
        rec.extra = rest;
        rec.extraText = JSON.stringify(rest, null, 2);
      }
      proxies.push(rec);
    };

    if (Array.isArray(parsed)) {
      for (const x of parsed) {
        if (!x) continue;
        const slug = String(x.slug ?? "").trim();
        const port = x.port != null ? String(x.port).trim() : "";
        if (!slug || !port) continue;
        pushEntry(slug, port, x);
      }
    } else if (parsed && typeof parsed === "object") {
      for (const [slugKey, spec] of Object.entries(parsed)) {
        const slug = String(slugKey || "").trim();
        if (!slug) continue;

        if (typeof spec === "string" || typeof spec === "number") {
          const port = String(spec).trim();
          if (port) pushEntry(slug, port, {});
        } else if (spec && typeof spec === "object") {
          const port = spec.port != null ? String(spec.port).trim() : "";
          if (!port) continue;
          pushEntry(slug, port, spec);
        }
      }
    }
  } catch (e) {
    console.warn("vncp: failed to parse proxies label as JSON:", e);
  }
  return proxies;
}


// compute dashboard links from current page base URL + /slug
function buildDashboardLinks(proxies = []) {
  try {
    const origin = window.location.origin || "";
    return proxies
      .filter(p => p && p.slug)
      .map(p => ({
        slug: p.slug,
        url: `${origin}/${p.slug.replace(/^\/+/, "")}`
      }));
  } catch {
    return [];
  }
}

/* ---------------- Proxy row ---------------- */

function ProxyMapRow(props) {
  const { idx, item = {}, onChange, removeitem, validationFailed = {} } = props;

  const slug = item.slug ?? "";
  const port = item.port ?? "";
  const nginxBlockText = item.nginxBlockText ?? "";
  const vSlug = validationFailed?.slug;
  const vPort = validationFailed?.port;
  const vBlock = validationFailed?.nginx_block;

  return (
    <>
      <FormGroup
        fieldId={`vncp-proxy-slug-${idx}`}
        label={_("Slug")}
        helperTextInvalid={vSlug}
        validated={vSlug ? "error" : "default"}
      >
        <TextInput
          id={`vncp-proxy-slug-${idx}`}
          value={slug}
          validated={vSlug ? "error" : "default"}
          onChange={(_, val) => onChange(idx, "slug", val)}
          placeholder="openhab"
        />
      </FormGroup>

      <FormGroup
        fieldId={`vncp-proxy-port-${idx}`}
        label={_("Port")}
        helperTextInvalid={vPort}
        validated={vPort ? "error" : "default"}
      >
        <NumberInput
          id={`vncp-proxy-port-${idx}`}
          value={port === "" ? "" : Math.max(1, Math.min(65535, parseInt(port, 10) || 0))}
          min={1}
          max={65535}
          widthChars={6}
          onMinus={() => {
            const n = Math.max(1, (parseInt(port, 10) || 1) - 1);
            onChange(idx, "port", String(n));
          }}
          onPlus={() => {
            const n = Math.min(65535, (parseInt(port, 10) || 0) + 1);
            onChange(idx, "port", String(n));
          }}
          onChange={(ev) => {
            const raw = ev?.target?.value ?? "";
            const n = raw === "" ? "" : Math.max(1, Math.min(65535, parseInt(raw, 10) || 0));
            onChange(idx, "port", String(n));
          }}
        />
      </FormGroup>

      {/* right-aligned remove button */}
      <FormGroup fieldId={`vncp-proxy-remove-${idx}`} className="remove-button-group">
        <Button variant="link" onClick={() => removeitem(idx)}>
          {_("Remove")}
        </Button>
      </FormGroup>

      {/* Nginx server/location block editor */}
      <FormGroup
        fieldId={`vncp-proxy-nginx-block-${idx}`}
        label={_("Nginx block")}
        helperTextInvalid={vBlock}
        validated={vBlock ? "error" : "default"}
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <Button
            variant="secondary"
            onClick={() => onChange(idx, "nginxBlockText", nginxBlockText?.trim() ? nginxBlockText : starterNginxBlock())}
          >
            {nginxBlockText?.trim() ? _("Reinsert starter") : _("Insert starter")}
          </Button>
          <Popover
            aria-label={_("Variables help")}
            enableFlip
            bodyContent={
              <div className="pf-v5-c-content">
                <p>{_("You can use these variables; the host generator will substitute them:")}</p>
                <ul>
                  <li><code>${"{SLUG}"}</code></li>
                  <li><code>${"{PATH}"}</code></li>
                  <li><code>${"{UPSTREAM_IP}"}</code></li>
                  <li><code>${"{UPSTREAM_PORT}"}</code></li>
                  <li><code>${"{UPSTREAM}"}</code></li>
                </ul>
                <p>{_("Do not include server{} or http{}; this snippet is placed inside a shared server block.")}</p>
              </div>
            }>
            <button onClick={e => e.preventDefault()} className="pf-v5-c-form__group-label-help">
              <OutlinedQuestionCircleIcon />
            </button>
          </Popover>
        </div>

        <TextArea
          id={`vncp-proxy-nginx-block-${idx}`}
          value={nginxBlockText}
          resizeOrientation="vertical"
          rows={12}
          validated={vBlock ? "error" : "default"}
          placeholder={starterNginxBlock()}
          onChange={(_, val) => onChange(idx, "nginxBlockText", val)}
        />
      </FormGroup>
    </>
  );
}






/* --------------------------- component --------------------------- */

export class ImageRunModal extends React.Component {
  constructor(props) {
    super(props);

    this._isMounted = false;
    this._queuedValidation = null;

    let command = "";
    if (this.props.image && this.props.image.Command) {
      command = utils.quote_cmdline(this.props.image.Command);
    }
    const entrypoint = utils.quote_cmdline(this.props.image?.Entrypoint);

    let selectedImage = "";
    if (this.props.image) {
      selectedImage = utils.image_name(this.props.image);
    }

    const initialImageRef = this.props.image
      ? (this.props.image.RepoTags?.[0] || this.props.image.Name || "")
      : (typeof selectedImage === "string" ? selectedImage : selectedImage?.Name || "");
    const autoNameInit = makeAutoName(initialImageRef || "");

    this.state = {
      command,
      containerName: autoNameInit,
      autoName: true,
      entrypoint,
      env: [],
      proxies: [],            // only read/write JSON proxies
      baseLabels: {},
      hasTTY: true,
      publish: [],
      image: props.image,
      memory: 512,
      cpuShares: 1024,
      memoryConfigure: false,
      cpuSharesConfigure: false,
      memoryUnit: 'MB',
      validationFailed: {},
      volumes: [],
      restartPolicy: "always",
      restartTries: 5,
      pullLatestImage: false,
      activeTabKey: 0,
      selectedImage,
      searchFinished: false,
      searchInProgress: false,
      searchText: "",
      imageResults: {},
      isImageSelectOpen: false,
      searchByRegistry: 'all',
      healthcheck_command: "",
      healthcheck_shell: false,
      healthcheck_interval: 30,
      healthcheck_timeout: 30,
      healthcheck_start_period: 0,
      healthcheck_retries: 3,
      healthcheck_action: 0,
      prefillLoading: false,
      prefillNonce: 0,
      useHostNetwork: false,
      networkName: "versanode",
      readmeLoading: false,
      readmeMd: "",
      readmeError: "",
      userTouchedProxies: false
    };
    this.getCreateConfig = this.getCreateConfig.bind(this);
    this.onValueChanged = this.onValueChanged.bind(this);
  }

  componentDidMount() {
    this._isMounted = true;
    this.onSearchTriggered(this.state.searchText);
    if (this.props.image) {
      this.loadImageDefaults(this.props.image);
    }
    if (this._queuedValidation) {
      this.setState({ validationFailed: this._queuedValidation });
      this._queuedValidation = null;
    }
    if (this._pendingState) {
      this.setState(this._pendingState);
      this._pendingState = null;
    }
  }
  componentWillUnmount() {
    this._isMounted = false;
    if (this.activeConnection) this.activeConnection.close();
  }

  // ---------------------- inspect + prefill + README + PROXIES ----------------------
  loadImageDefaults = async (imageRef) => {
    try {
      if (!imageRef) return;

      // Resolve ref
      let ref = "";
      if (typeof imageRef === "string") ref = imageRef;
      else if (typeof imageRef === "object") ref = imageRef.Id || imageRef.RepoTags?.[0] || imageRef.Name || "";
      if (!ref) return;

      if (isGhcrVersaNodeTerm(ref)) ref = buildGhcrVersaNodeName(ref);
      ref = toCanonicalName(ref);
      dbg("resolved ref =", ref);

      if (this._isMounted) this.setState({ prefillLoading: true, readmeLoading: true, readmeError: "", readmeMd: "" });

      // Inspect image
      let inspected;
      try {
        inspected = await client.inspectImage(ref);
      } catch (e) {
        dbg("inspect failed:", e?.message || e);
        throw new Error(_("Failed to inspect image"));
      }
      dbg("vncp: inspect result basic =", {
        hasConfig: !!inspected?.Config,
        hasContainerConfig: !!inspected?.ContainerConfig,
        id: inspected?.Id,
        ref
      });

      const labels = inspected?.Config?.Labels
            || inspected?.ContainerConfig?.Labels
            || {};
      dbg("vncp: labels extracted =", labels);

      /* ★ Add this block right here */
      if (this._isMounted && wantHostNetworkFromLabels(labels)) {
        this.setState({ useHostNetwork: true });
      }
      /* ★ End added block */

      const cfg = inspected?.Config || {};
      const envArr = cfg?.Env || [];
      const volObj = cfg?.Volumes || {};
      const exposed = cfg?.ExposedPorts
              || inspected?.ContainerConfig?.ExposedPorts
              || {};
      const hc = cfg?.Healthcheck || {};

      // keep base labels for merge
      if (this._isMounted) this.setState({ baseLabels: labels });

      // Update auto name if still auto
      if (this._isMounted && this.state.autoName) {
        this.setState({ containerName: makeAutoName(ref, labels) });
      }

      // README from labels
      let readmeMd = readEmbeddedReadmeFromLabels(labels);
      if (readmeMd && this._isMounted) {
        this.setState({ readmeMd, readmeError: "", readmeLoading: false });
      }

     const hasUserEnv   = (this.state.env || []).some(x => x !== undefined);
      const hasUserVol   = (this.state.volumes || []).some(x => x !== undefined);
      const hasUserPorts = (this.state.publish || []).some(x => x !== undefined);
      const hasUserHC    = !!(this.state.healthcheck_command && this.state.healthcheck_command.trim().length);

      const parsedEnv     = parseEnvVars(envArr);
      const parsedVol     = parseVolumes(volObj);
      const parsedPorts   = parseExposedPorts(exposed);
      const parsedProxies = extractProxiesFromLabels(labels, exposed).map(p => {
        const r = { ...p };
        if (!r.nginxBlockText) {
          if (r.nginx_block_b64) {
            try { r.nginxBlockText = b64ToUtf8(r.nginx_block_b64); } catch {}
          } else if (r.nginx_block) {
            // legacy plain text label
            r.nginxBlockText = r.nginx_block;
          }
        }

        // NEW: de-escape $$ -> $ on load
        if (r.nginxBlockText) {
          r.nginxBlockText = normalizeLoadedNginxBlock(r.nginxBlockText);
        }

        return r;
      });

      // ✅ define before using/logging it
      const hasUserProxies =
        this.state.userTouchedProxies ||
        (this.state.proxies || []).some(p =>
          p && (String(p.slug || "").trim() || String(p.port || "").trim())
        );

      dbg("vncp: hasUserProxies?", hasUserProxies, "parsedProxies.length =", parsedProxies.length);

      const nextState = {};

      if (!hasUserEnv   && parsedEnv.length)   nextState.env     = parsedEnv;
      if (!hasUserVol   && parsedVol.length)   nextState.volumes = parsedVol;
      if (!hasUserPorts && parsedPorts.length) nextState.publish = parsedPorts;
      if (!hasUserProxies && parsedProxies.length) {
        nextState.proxies = parsedProxies;
        dbg("vncp: prefilled proxies =", parsedProxies);
      } else {
        dbg("vncp: NOT pre-filling proxies (userTouchedProxies or none parsed)");
      }

      // Healthcheck prefill
      if (!hasUserHC && (Array.isArray(hc?.Test) && hc.Test.length > 0)) {
        const test = hc.Test.slice();
        let shell = false;
        let cmdParts = [];
        if (test[0] === "CMD-SHELL") { shell = true; cmdParts = test.slice(1); }
        else if (test[0] === "CMD")  { shell = false; cmdParts = test.slice(1); }
        else                         { cmdParts = test; }
        const cmdJoined = utils.quote_cmdline(cmdParts);
        nextState.healthcheck_shell = shell;
        nextState.healthcheck_command = cmdJoined;
        if (hc.Interval != null)    nextState.healthcheck_interval     = nsToSec(hc.Interval);
        if (hc.Timeout != null)     nextState.healthcheck_timeout      = nsToSec(hc.Timeout);
        if (hc.StartPeriod != null) nextState.healthcheck_start_period = nsToSec(hc.StartPeriod);
        if (hc.Retries != null)     nextState.healthcheck_retries      = parseInt(hc.Retries, 10) || 0;
      }

      if (Object.keys(nextState).length) {
        nextState.prefillNonce = (this.state.prefillNonce || 0) + 1;
        if (this._isMounted) {
          dbg("vncp: applying nextState (prefillNonce =", nextState.prefillNonce, "):", nextState);
          this.setState(nextState);
        }
      }

    
      if (readmeMd && this._isMounted) {
        this.setState({ prefillLoading: false });
      }

      // Fallback README from inside image (unchanged)
      if (!readmeMd) {
        const isLocal = (function isLocalImageRef(imageOrName, localImages = []) {
          if (!imageOrName) return false;
          if (typeof imageOrName === "string") {
            const cand = toCanonicalName(imageOrName);
            return (this?.props?.localImages || []).some(li => (li.RepoTags || []).map(toCanonicalName).includes(cand));
          }
          if (typeof imageOrName === "object") {
            const byId = imageOrName.Id && (this?.props?.localImages || []).some(li => li.Id && li.Id === imageOrName.Id);
            if (byId) return true;
            const name = imageOrName.RepoTags?.[0] || imageOrName.Name || "";
            if (name) {
              const cand = toCanonicalName(name);
              return (this?.props?.localImages || []).some(li => (li.RepoTags || []).map(toCanonicalName).includes(cand));
            }
          }
          return false;
        }).call(this, ref, this.props.localImages || []);
        dbg("isLocal =", isLocal);

        if (!isLocal) {
          if (this._isMounted) {
            this.setState({
              readmeLoading: false,
              readmeError: _("README will be available after the image is pulled."),
              readmeMd: "",
              prefillLoading: false,
            });
          }
          return;
        }

        const readmePath = labels["io.versanode.vncp.readme.path"] || DEFAULT_README_PATH;
        dbg("fallback readmePath =", readmePath);

        try {
          const out = await cockpit.spawn(
            ["docker", "run", "--rm", "--entrypoint", "cat", ref, readmePath],
            { superuser: "try", err: "message" }
          );
          let readmeMd2 = out || "";
          dbg("cat README ok, length =", readmeMd2.length);
          if (this._isMounted) this.setState({ readmeMd: readmeMd2, readmeError: "", readmeLoading: false, prefillLoading: false });
        } catch (e) {
          dbg("cat README failed:", e?.message || e);
          if (this._isMounted) {
            this.setState({
              readmeLoading: false,
              prefillLoading: false,
              readmeError: e?.message || String(e),
              readmeMd: ""
            });
          }
        }
      }
    } catch (e) {
      dbg("outer error:", e?.message || e);
      if (this._isMounted) {
        this.setState({
          prefillLoading: false,
          readmeLoading: false,
          readmeError: e?.message || String(e),
          readmeMd: ""
        });
      }
    }
  };

  getCreateConfig() {
    const createConfig = {};
    createConfig.HostConfig = {};

    if (this.state.image) {
      const tags = this.state.image.RepoTags || [];
      createConfig.image = tags.length > 0 ? tags[0] : "";
    }
    else {
      let img = this.state.selectedImage?.Name || "";
      if (!img.includes(":")) img += ":latest";
      if (isGhcrVersaNodeTerm(img)) img = buildGhcrVersaNodeName(img);
      createConfig.image = img;
    }

    if (this.state.containerName)
      createConfig.name = normalizeContainerName(this.state.containerName);

    if (this.state.command)
      createConfig.command = utils.unquote_cmdline(this.state.command);

    if (this.state.memoryConfigure && this.state.memory) {
      const memorySize = this.state.memory * (1000 ** units[this.state.memoryUnit].baseExponent);
      createConfig.HostConfig.Memory = memorySize;
    }

    if (this.state.cpuSharesConfigure && parseInt(this.state.cpuShares) !== 0)
      createConfig.HostConfig.CpuShares = parseInt(this.state.cpuShares);

    createConfig.terminal = this.state.hasTTY;

    if (this.state.publish.some(port => port !== undefined)) {
      const PortBindings = {};
      const ExposedPorts = {};
      this.state.publish
        .filter(port => port?.containerPort)
        .forEach(item => {
          ExposedPorts[item.containerPort + "/" + item.protocol] = {};
          const mapping = {};
          if (item.hostPort) mapping.HostPort = String(item.hostPort);
          if (item.IP) mapping.HostIp = item.IP;
          if (Object.keys(mapping).length > 0) {
            PortBindings[item.containerPort + "/" + item.protocol] = [mapping];
          }
        });

      if (Object.keys(PortBindings).length > 0)
        createConfig.HostConfig.PortBindings = PortBindings;
      if (Object.keys(ExposedPorts).length > 0)
        createConfig.ExposedPorts = ExposedPorts;
    }

    if (this.state.env.some(item => item !== undefined)) {
      const envs = [];
      this.state.env.forEach(item => {
        if (item !== undefined)
          envs.push(item.envKey + "=" + item.envValue);
      });
      createConfig.Env = envs;
    }

    if (this.state.volumes.some(volume => volume !== undefined)) {
      createConfig.HostConfig.Mounts = this.state.volumes
        .filter(volume => volume?.hostPath && volume?.containerPath)
        .map(volume => ({
          Source: volume.hostPath,
          Target: volume.containerPath,
          Type: "bind",
          ReadOnly: !!volume.readOnly
        }));
    }

    if (this.state.restartPolicy !== "no") {
      createConfig.HostConfig.RestartPolicy = { Name: this.state.restartPolicy };
      if (this.state.restartPolicy === "on-failure" && this.state.restartTries !== null) {
        createConfig.HostConfig.RestartPolicy.MaximumRetryCount = parseInt(this.state.restartTries);
      }
      if (this.state.restartPolicy === "always" && (this.props.serviceAvailable)) {
        this.enableDockerRestartService();
      }
    }

    if (this.state.healthcheck_command !== "") {
      const test = utils.unquote_cmdline(this.state.healthcheck_command);
      if (this.state.healthcheck_shell) {
        test.unshift("CMD-SHELL");
      } else {
        test.unshift("CMD");
      }
      createConfig.Healthcheck = {
        Interval: parseInt(this.state.healthcheck_interval) * 1000000000,
        Retries: this.state.healthcheck_retries,
        StartPeriod: parseInt(this.state.healthcheck_start_period) * 1000000000,
        Test: test,
        Timeout: parseInt(this.state.healthcheck_timeout) * 1000000000,
      };
      createConfig.health_check_on_failure_action = parseInt(this.state.healthcheck_action);
    }

    // --- Networking ---
    if (this.state.useHostNetwork) {
      createConfig.HostConfig.NetworkMode = "host";
      delete createConfig.HostConfig.PortBindings;
      delete createConfig.ExposedPorts;
      delete createConfig.NetworkingConfig;
    } else {
      const NET = this.state.networkName || "versanode";
      createConfig.HostConfig.NetworkMode = NET;
      createConfig.NetworkingConfig = {
        EndpointsConfig: {
          [NET]: {},
        },
      };
    }

    // --- Labels: merge base image labels and add ONLY JSON proxies ---
    const mergedLabels = { ...(this.state.baseLabels || {}) };

   const cleanProxies = (this.state.proxies || [])
  .filter(p => p && String(p.slug || "").trim() && String(p.port || "").trim())
  .map(p => {
    const out = { slug: String(p.slug).trim(), port: String(p.port).trim() };
    const block = (p.nginxBlockText || "").trim();
    if (block) out.nginx_block_b64 = utf8ToB64(block);
    return block ? out : undefined;    // keep validation semantics
  })
  .filter(Boolean);     


    if (cleanProxies.length) {
      mergedLabels[`${VNCP_PFX}.proxies`] = JSON.stringify(cleanProxies);
    }

    if (Object.keys(mergedLabels).length) {
      createConfig.Labels = mergedLabels;
    }

    return createConfig;
  }

  createContainer = (createConfig, runImage) => {
    const Dialogs = this.props.dialogs;
    client.createContainer(createConfig)
      .then(reply => {
        if (runImage) {
          client.postContainer("start", reply.Id, {})
            .then(() => Dialogs.close())
            .catch(ex => {
              client.delContainer(reply.Id, true)
                .then(() => {
                  this.setState({
                    dialogError: _("Container failed to be started"),
                    dialogErrorDetail: cockpit.format("$0: $1", ex.reason, ex.message)
                  });
                })
                .catch(ex => {
                  this.setState({
                    dialogError: _("Failed to clean up container"),
                    dialogErrorDetail: cockpit.format("$0: $1", ex.reason, ex.message)
                  });
                });
            });
        } else {
          Dialogs.close();
        }
      })
      .catch(ex => {
        this.setState({
          dialogError: _("Container failed to be created"),
          dialogErrorDetail: cockpit.format("$0: $1", ex.reason, ex.message)
        });
      });
  };

  async onCreateClicked(runImage = false) {
    if (!await this.validateForm())
      return;

    const Dialogs = this.props.dialogs;
    const createConfig = this.getCreateConfig();
    const { pullLatestImage } = this.state;
    let imageExists = true;

    // Ensure the target network exists
    try {
      const netMode = createConfig?.HostConfig?.NetworkMode;
      if (netMode && netMode !== "host" && netMode !== "none") {
        await client.ensureNetwork(netMode);
      }
    } catch (e) {
      this.setState({
        dialogError: _("Failed to ensure network exists"),
        dialogErrorDetail: e.message || String(e),
      });
      return;
    }

    try {
      await client.imageExists(createConfig.image);
    } catch (error) {
      imageExists = false;
    }

    if (imageExists && !pullLatestImage) {
      this.createContainer(createConfig, runImage);
    } else {
      Dialogs.close();

      // stub row for “downloading …”
      const tempImage = { ...createConfig };
      tempImage.Id = createConfig.name;
      tempImage.Name = createConfig.name;
      tempImage.name = createConfig.name;
      tempImage.State = { Status: _("downloading") };
      tempImage.Created = new Date();
      tempImage.image = createConfig.image;
      tempImage.Image = createConfig.image;
      tempImage.isDownloading = true;

      onDownloadContainer(tempImage);

      client.pullImage(createConfig.image).then(reply => {
        client.createContainer(createConfig)
          .then(reply => {
            if (runImage) {
              client.postContainer("start", reply.Id, {})
                .then(() => onDownloadContainerFinished(createConfig))
                .catch(ex => {
                  onDownloadContainerFinished(createConfig);
                  const error = cockpit.format(_("Failed to run container $0"), createConfig.name);
                  this.props.onAddNotification({ type: 'danger', error, errorDetail: ex.message });
                });
            } else {
              onDownloadContainerFinished(createConfig);
            }
          })
          .catch(ex => {
            onDownloadContainerFinished(createConfig);
            const error = cockpit.format(_("Failed to create container $0"), createConfig.name);
            this.props.onAddNotification({ type: 'danger', error, errorDetail: ex.reason });
          });
      })
        .catch(ex => {
          onDownloadContainerFinished(createConfig);
          const error = cockpit.format(_("Failed to pull image $0"), createConfig.image);
          this.props.onAddNotification({ type: 'danger', error, errorDetail: ex.message });
        });
    }
  }

  onValueChanged(key, value) {
    if (!this._isMounted) {
      this._pendingState = { ...(this._pendingState || {}), [key]: value };
      return;
    }
    this.setState({ [key]: value });
  }
  onPlusOne(key) {
    this.setState(state => ({ [key]: parseInt(state[key]) + 1 }));
  }
  onMinusOne(key) {
    this.setState(state => ({ [key]: parseInt(state[key]) - 1 }));
  }
  handleTabClick = (event, tabIndex) => {
    event.preventDefault();
    this.setState({ activeTabKey: tabIndex });
  };

  onSearchTriggered = value => {
    if (value.length < 2) return;

    const patt = /:[\w|\d]+$/;
    if (patt.test(value)) return;

    const selectedIndex = this.state.searchByRegistry;
    const targetGhcr = selectedIndex === 'ghcr.io' || isGhcrVersaNodeTerm(value);
    if (targetGhcr) {
      const name = buildGhcrVersaNodeName(value);
      const images = name && name !== GHCR_NAMESPACE.replace(/\/+$/, "")
        ? { "ghcr.io": [{ Name: name, Description: "GitHub Container Registry (versa-node)" }] }
        : { "ghcr.io": [] };

      if (this.activeConnection) this.activeConnection.close();

      this.setState({
        imageResults: images,
        searchFinished: true,
        searchInProgress: false,
        dialogError: "",
        dialogErrorDetail: "",
      });
      return;
    }

    if (this.activeConnection) this.activeConnection.close();

    this.setState({ searchFinished: false, searchInProgress: true });
    this.activeConnection = rest.connect(client.getAddress());
    let searches = [];

    if (Object.keys(this.props.dockerInfo.registries).length !== 0 || value.includes('/')) {
      searches.push(this.activeConnection.call({
        method: "GET",
        path: client.VERSION + "/images/search",
        body: "",
        params: { term: value }
      }));
    } else {
      searches = searches.concat(utils.fallbackRegistries.map(registry =>
        this.activeConnection.call({
          method: "GET",
          path: client.VERSION + "/images/search",
          body: "",
          params: { term: registry + "/" + value }
        })));
    }

    Promise.allSettled(searches)
      .then(reply => {
        if (reply && this._isMounted) {
          let imageResults = [];
          let dialogError = "";
          let dialogErrorDetail = "";

          for (const result of reply) {
            if (result.status === "fulfilled") {
              imageResults = imageResults.concat(JSON.parse(result.value));
            } else {
              dialogError = _("Failed to search for new images");
              dialogErrorDetail = result.reason
                ? cockpit.format(_("Failed to search for images: $0"), result.reason.message)
                : _("Failed to search for images.");
            }
          }
          const images = {};
          imageResults.forEach(image => {
            image.toString = function imageToString() {
              if (this.Tag) return this.Name + ':' + this.Tag;
              return this.Name;
            };

            let index = image.Index;
            if (!index) index = image.Name.split('/')[0];

            if (index in images) images[index].push(image);
            else images[index] = [image];
          });
          this.setState({
            imageResults: images || {},
            searchFinished: true,
            searchInProgress: false,
            dialogError,
            dialogErrorDetail,
          });
        }
      });
  };

  clearImageSelection = () => {
    let command = this.state.command;
    if (this.state.command === utils.quote_cmdline(this.state.selectedImage?.Command))
      command = "";

    this.setState({
      selectedImage: "",
      image: "",
      isImageSelectOpen: false,
      imageResults: {},
      searchText: "",
      searchFinished: false,
      command,
      entrypoint: "",
      readmeMd: "",
      readmeError: "",
    });
  };
  onImageSelectToggle = (_, isOpen) => {
    this.setState({ isImageSelectOpen: isOpen });
  };
  onImageSelect = (event, value) => {
    if (event === undefined) return;

    let command = this.state.command;
    if (value.Command && !command)
      command = utils.quote_cmdline(value.Command);

    const entrypoint = utils.quote_cmdline(value?.Entrypoint);

    this.setState(prev => ({
      selectedImage: value,
      isImageSelectOpen: false,
      command,
      entrypoint
    }), () => {
      this.loadImageDefaults(value);
    });
  };
  handleImageSelectInput = value => {
    this.setState({
      searchText: value,
      searchFinished: false,
      selectedImage: "",
    });
    this.onSearchTriggered(value);
  };
  debouncedInputChanged = debounce(300, this.handleImageSelectInput);

  enableDockerRestartService = () => {
    const argv = ["systemctl", "enable", "docker.service"];
    cockpit.spawn(argv, { superuser: "require", err: "message" })
      .catch(err => {
        console.warn("Failed to enable docker.service:", JSON.stringify(err));
      });
  };

  isFormInvalid = validationFailed => {
    const groupHasError = row => row && Object.values(row).filter(val => val).length > 0;

    return validationFailed.publish?.some(groupHasError) ||
      validationFailed.volumes?.some(groupHasError) ||
      validationFailed.env?.some(groupHasError) ||
      validationFailed.proxies?.some(groupHasError) ||
      !!validationFailed.containerName ||
      !!validationFailed.networkName;
  };

  async validateContainerName(containerName) {
    try {
      await client.containerExists(containerName);
    } catch (error) {
      return;
    }
    return _("Name already in use");
  }

  async validateForm() {
    const { publish, volumes, env, proxies, containerName } = this.state;
    const validationFailed = { };

    const publishValidation = publish.map(a => {
      if (a === undefined) return undefined;
      return {
        IP: validatePublishPort(a.IP, "IP"),
        hostPort: validatePublishPort(a.hostPort, "hostPort"),
        containerPort: validatePublishPort(a.containerPort, "containerPort"),
      };
    });
    if (publishValidation.some(entry => entry && Object.keys(entry).length > 0))
      validationFailed.publish = publishValidation;

    const volumesValidation = volumes.map(a => {
      if (a === undefined) return undefined;
      return {
        hostPath: validateVolume(a.hostPath, "hostPath"),
        containerPath: validateVolume(a.containerPath, "containerPath"),
      };
    });
    if (volumesValidation.some(entry => entry && Object.keys(entry).length > 0))
      validationFailed.volumes = volumesValidation;

    const envValidation = env.map(a => {
      if (a === undefined) return undefined;
      return {
        envKey: validateEnvVar(a.envKey, "envKey"),
        envValue: validateEnvVar(a.envValue, "envValue"),
      };
    });
    if (envValidation.some(entry => entry && Object.keys(entry).length > 0))
      validationFailed.env = envValidation;

    const proxiesValidation = proxies.map(a => {
  if (a === undefined) return undefined;
  const row = {
    slug: validateSlug(a.slug),
    port: validateProxyPort(a.port),
    nginx_block: undefined,
  };

  const block = (a.nginxBlockText || "").trim();
  if (!block) row.nginx_block = _("Nginx block is required");

  // (Optional) sanity checks to help users:
  // if (/\bserver\s*\{/.test(block) || /\bhttp\s*\{/.test(block)) {
  //   row.nginx_block = _("Do not include server{} or http{} blocks; only a location/snippet.");
  // }

  return row;
});
if (proxiesValidation.some(entry => entry && (entry.slug || entry.port || entry.nginx_block)))
  validationFailed.proxies = proxiesValidation;


    const containerNameValidation = await this.validateContainerName(containerName);
    if (containerNameValidation)
      validationFailed.containerName = containerNameValidation;

    if (!this.state.useHostNetwork) {
      const n = (this.state.networkName || "").trim();
      if (!n) {
        validationFailed.networkName = _("Network name is required when not using host network");
      } else if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(n)) {
        validationFailed.networkName = _("Invalid network name (allowed: letters, numbers, . _ -)");
      }
    }

    this.setState({ validationFailed });
    return !this.isFormInvalid(validationFailed);
  }

  dynamicListOnValidationChange = (key, value) => {
    const current = this.state?.validationFailed || {};
    const merged = { ...current, [key]: value };
    if (merged[key] && merged[key].every(a => a === undefined)) {
      delete merged[key];
    }
    if (!this._isMounted) {
      this._queuedValidation = merged;
      return;
    }
    this.setState({ validationFailed: merged });
  };

  render() {
    const Dialogs = this.props.dialogs;
    const { registries, dockerRestartAvailable, selinuxAvailable, version } = this.props.dockerInfo;
    const { image } = this.props;
    const dialogValues = this.state;
    const { activeTabKey, selectedImage } = this.state;

    let imageListOptions = [];
    if (!image) {
      imageListOptions = this.filterImages?.() || [];
    }

    const localImage = this.state.image || (selectedImage && this.props.localImages?.some(img => img.Id === selectedImage.Id));
    const dockerRegistries = registries && registries.search ? registries.search : utils.fallbackRegistries;

    const footer = (
      <ToggleGroup className='image-search-footer' aria-label={_("Search by registry")}>
        <ToggleGroupItem
          text={_("All")}
          key='all'
          isSelected={this.state.searchByRegistry == 'all'}
          onChange={(ev, _) => { ev.stopPropagation(); this.setState({ searchByRegistry: 'all' }); }}
          onTouchStart={ev => ev.stopPropagation()}
        />
        <ToggleGroupItem
          text={_("Local")}
          key='local'
          isSelected={this.state.searchByRegistry == 'local'}
          onChange={(ev, _) => { ev.stopPropagation(); this.setState({ searchByRegistry: 'local' }); }}
          onTouchStart={ev => ev.stopPropagation()}
        />
        {dockerRegistries.map(registry => {
          const index = this.truncateRegistryDomain ? this.truncateRegistryDomain(registry) : registry;
          return (
            <ToggleGroupItem
              text={index}
              key={index}
              isSelected={ this.state.searchByRegistry == index }
              onChange={ (ev, _) => { ev.stopPropagation(); this.setState({ searchByRegistry: index }); } }
              onTouchStart={ ev => ev.stopPropagation() }
            />
          );
        })}
      </ToggleGroup>
    );

    // Show README (if any) and computed dashboard links (origin + /slug)
    const dashboards = buildDashboardLinks(this.state.proxies || []);
    dbg("vncp: render proxies value =", this.state.proxies);
    const infoBody = (
      <div style={{ padding: "var(--pf-v5-global--spacer--md)" }}>
        {this.state.readmeLoading && (
          <div className="pf-v5-c-skeleton" style={{height:16, width:200, margin:"8px 0"}} />
        )}
        {!this.state.readmeLoading && this.state.readmeError && !this.state.readmeMd && (
          <div className="pf-v5-c-helper-text pf-m-error">{this.state.readmeError}</div>
        )}
        {!this.state.readmeLoading && this.state.readmeMd && (
          <div className="vncp-readme" style={{ marginBottom: 12 }}><Markdown source={this.state.readmeMd} /></div>
        )}
        {/* Dashboard links derived from proxies */}
        <div>
          <div className="pf-v5-c-title pf-m-md" style={{ margin: "8px 0" }}>{_("Dashboards")}</div>
          {dashboards.length === 0 ? (
            <div className="pf-v5-c-helper-text">{_("No dashboards defined (add proxy slugs in Details tab).")}</div>
          ) : (
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {dashboards.map(d => (
                <li key={d.slug}>
                  <a href={d.url} target="_blank" rel="noopener noreferrer">{`/${d.slug}`}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );

    return (
      <Modal
        isOpen
        position="top"
        variant="medium"
        onClose={Dialogs.close}
        onEscapePress={() => {
          if (this.state.isImageSelectOpen) {
            this.onImageSelectToggle(!this.state.isImageSelectOpen);
          } else {
            Dialogs.close();
          }
        }}
        title={_("Create container")}
        footer={
          <>
            <Button
              variant='primary'
              id="create-image-create-run-btn"
              onClick={() => this.onCreateClicked(true)}
              isDisabled={(!image && selectedImage === "") || this.isFormInvalid(dialogValues.validationFailed)}
            >
              {_("Create and run")}
            </Button>
            <Button
              variant='secondary'
              id="create-image-create-btn"
              onClick={() => this.onCreateClicked(false)}
              isDisabled={(!image && selectedImage === "") || this.isFormInvalid(dialogValues.validationFailed)}
            >
              {_("Create")}
            </Button>
            <Button variant='link' className='btn-cancel' onClick={Dialogs.close}>
              {_("Cancel")}
            </Button>
          </>
        }
      >
        <Form>
          {this.state.dialogError && <ErrorNotification errorMessage={this.state.dialogError} errorDetail={this.state.dialogErrorDetail} />}

          <FormGroup id="image-name-group" fieldId='run-image-dialog-name' label={_("Name")} className="ct-m-horizontal">
            <TextInput
              id='run-image-dialog-name'
              className="image-name"
              placeholder={_("Container name")}
              validated={dialogValues.validationFailed.containerName ? "error" : "default"}
              value={dialogValues.containerName}
              onChange={(_, value) => {
                if (this.state.autoName) this.onValueChanged("autoName", false);
                utils.validationClear(dialogValues.validationFailed, "containerName", (value2) => this.onValueChanged("validationFailed", value2));
                utils.validationDebounce(async () => {
                  const delta = await this.validateContainerName(value);
                  if (delta)
                    this.onValueChanged("validationFailed", { ...dialogValues.validationFailed, containerName: delta });
                });
                this.onValueChanged('containerName', value);
              }}
            />
            <FormHelper helperTextInvalid={dialogValues.validationFailed.containerName} />
          </FormGroup>

          <Tabs activeKey={activeTabKey} onSelect={this.handleTabClick}>
            {/* Info */}
            <Tab eventKey={0} title={<TabTitleText>{_("Info")}</TabTitleText>} className="pf-v5-c-form pf-m-horizontal">
              {infoBody}
            </Tab>

            {/* Details */}
            <Tab eventKey={1} title={<TabTitleText>{_("Details")}</TabTitleText>} className="pf-v5-c-form">
              <FormGroup
                fieldId="create-image-image-select-typeahead"
                label={_("Image")}
                labelIcon={!this.props.image &&
                  <Popover
                    aria-label={_("Image selection help")}
                    enableFlip
                    bodyContent={
                      <Flex direction={{ default: 'column' }}>
                        <FlexItem>{_("host[:port]/[user]/container[:tag]")}</FlexItem>
                        <FlexItem>{cockpit.format(_("Example: $0"), "quay.io/busybox")}</FlexItem>
                        <FlexItem>{cockpit.format(_("Searching: $0"), "quay.io/busybox")}</FlexItem>
                        <FlexItem>{cockpit.format(_("GHCR (versa-node): $0"), "versa-node/<repo> or ghcr.io/versa-node/<repo>")}</FlexItem>
                      </Flex>
                    }>
                    <button onClick={e => e.preventDefault()} className="pf-v5-c-form__group-label-help">
                      <OutlinedQuestionCircleIcon />
                    </button>
                  </Popover>
                }
              >
                <Select
                  toggleId='create-image-image'
                  isGrouped
                  {...(this.state.searchInProgress && { loadingVariant: 'spinner' })}
                  menuAppendTo={() => document.body}
                  variant={SelectVariant.typeahead}
                  noResultsFoundText={_("No images found")}
                  onToggle={this.onImageSelectToggle}
                  isOpen={this.state.isImageSelectOpen}
                  selections={selectedImage}
                  isInputValuePersisted
                  placeholderText={_("Search string or container location")}
                  onSelect={this.onImageSelect}
                  onClear={this.clearImageSelection}
                  onFilter={() => {}}
                  onTypeaheadInputChanged={this.debouncedInputChanged}
                  footer={footer}
                  isDisabled={!!this.props.image}
                >
                  {imageListOptions}
                </Select>
              </FormGroup>

              {(image || localImage) &&
                <FormGroup fieldId="run-image-dialog-pull-latest-image">
                  <Checkbox
                    isChecked={this.state.pullLatestImage}
                    id="run-image-dialog-pull-latest-image"
                    onChange={(_event, value) => this.onValueChanged('pullLatestImage', value)}
                    label={_("Pull latest image")}
                  />
                </FormGroup>
              }

              {dialogValues.entrypoint &&
                <FormGroup fieldId='run-image-dialog-entrypoint' hasNoPaddingTop label={_("Entrypoint")}>
                  <Text id="run-image-dialog-entrypoint">{dialogValues.entrypoint}</Text>
                </FormGroup>
              }

              <FormGroup fieldId='run-image-dialog-command' label={_("Command")}>
                <TextInput
                  id='run-image-dialog-command'
                  value={dialogValues.command || ''}
                  onChange={(_, value) => this.onValueChanged('command', value)}
                />
              </FormGroup>

              {/* Proxy slugs */}
              <DynamicListForm
                  key={`proxies-${this.state.prefillNonce}`}
                  id="run-image-dialog-proxies"
                  emptyStateString={_("No proxy mappings")}
                  formclass="vncp-proxy-form"
                  label={_("Proxies")}
                  actionLabel={_("Add proxy")}
                  helperText={_("Each row defines a slug, a container port, and an Nginx snippet (saved to label io.versanode.vncp.proxies).")}
                  validationFailed={dialogValues.validationFailed.proxies}
                  onValidationChange={value => this.dynamicListOnValidationChange("proxies", value)}
                 onChange={(value) => {
                  this.onValueChanged("userTouchedProxies", true);
                  this.onValueChanged("proxies", value);
                }}
                  value={dialogValues.proxies}
                  default={{ slug: null, port: null }}
                  itemcomponent={ProxyMapRow}
                />

              <FormGroup fieldId="run-image-dialog-tty">
                <Checkbox
                  id="run-image-dialog-tty"
                  isChecked={this.state.hasTTY}
                  label={_("With terminal")}
                  onChange={(_event, checked) => this.onValueChanged('hasTTY', checked)}
                />
              </FormGroup>

              <FormGroup fieldId="run-image-dialog-hostnet">
                <Checkbox
                  id="run-image-dialog-hostnet"
                  isChecked={this.state.useHostNetwork}
                  label={_("Use host network")}
                  description={_("Ignores port mappings; container shares the host’s network namespace.")}
                  onChange={(_event, checked) => this.onValueChanged('useHostNetwork', checked)}
                />
              </FormGroup>
              {!this.state.useHostNetwork && (
                <FormGroup
                  fieldId="run-image-dialog-network-name"
                  label={_("Docker network")}
                  helperTextInvalid={dialogValues.validationFailed.networkName}
                  validated={dialogValues.validationFailed.networkName ? "error" : "default"}
                >
                  <TextInput
                    id="run-image-dialog-network-name"
                    value={this.state.networkName}
                    onChange={(_, val) => this.onValueChanged("networkName", (val || "").trim())}
                    placeholder="versanode"
                    validated={dialogValues.validationFailed.networkName ? "error" : "default"}
                  />
                </FormGroup>
              )}

              <FormGroup fieldId='run-image-dialog-memory' label={_("Memory limit")}>
                <Flex alignItems={{ default: 'alignItemsCenter' }} className="ct-input-group-spacer-sm modal-run-limiter" id="run-image-dialog-memory-limit">
                  <Checkbox
                    id="run-image-dialog-memory-limit-checkbox"
                    isChecked={this.state.memoryConfigure}
                    onChange={(_event, checked) => this.onValueChanged('memoryConfigure', checked)}
                  />
                  <NumberInput
                    value={dialogValues.memory}
                    id="run-image-dialog-memory"
                    min={0}
                    isDisabled={!this.state.memoryConfigure}
                    onClick={() => !this.state.memoryConfigure && this.onValueChanged('memoryConfigure', true)}
                    onPlus={() => this.onPlusOne('memory')}
                    onMinus={() => this.onMinusOne('memory')}
                    minusBtnAriaLabel={_("Decrease memory")}
                    plusBtnAriaLabel={_("Increase memory")}
                    onChange={ev => this.onValueChanged('memory', parseInt(ev.target.value) < 0 ? 0 : ev.target.value)}
                  />
                  <FormSelect
                    id='memory-unit-select'
                    aria-label={_("Memory unit")}
                    value={this.state.memoryUnit}
                    isDisabled={!this.state.memoryConfigure}
                    className="dialog-run-form-select"
                    onChange={(_event, value) => this.onValueChanged('memoryUnit', value)}
                  >
                    <FormSelectOption value={units.KB.name} key={units.KB.name} label={_("KB")} />
                    <FormSelectOption value={units.MB.name} key={units.MB.name} label={_("MB")} />
                    <FormSelectOption value={units.GB.name} key={units.GB.name} label={_("GB")} />
                  </FormSelect>
                </Flex>
              </FormGroup>

              <FormGroup
                fieldId='run-image-cpu-priority'
                label={_("CPU shares")}
                labelIcon={
                  <Popover
                    aria-label={_("CPU Shares help")}
                    enableFlip
                    bodyContent={_("CPU shares determine the priority of running containers. Default priority is 1024. A higher number prioritizes this container. A lower number decreases priority.")}
                  >
                    <button onClick={e => e.preventDefault()} className="pf-v5-c-form__group-label-help">
                      <OutlinedQuestionCircleIcon />
                    </button>
                  </Popover>
                }
              >
                <Flex alignItems={{ default: 'alignItemsCenter' }} className="ct-input-group-spacer-sm modal-run-limiter" id="run-image-dialog-cpu-priority">
                  <Checkbox
                    id="run-image-dialog-cpu-priority-checkbox"
                    isChecked={this.state.cpuSharesConfigure}
                    onChange={(_event, checked) => this.onValueChanged('cpuSharesConfigure', checked)}
                  />
                  <NumberInput
                    id="run-image-cpu-priority"
                    value={dialogValues.cpuShares}
                    onClick={() => !this.state.cpuSharesConfigure && this.onValueChanged('cpuSharesConfigure', true)}
                    min={2}
                    max={262144}
                    isDisabled={!this.state.cpuSharesConfigure}
                    onPlus={() => this.onPlusOne('cpuShares')}
                    onMinus={() => this.onMinusOne('cpuShares')}
                    minusBtnAriaLabel={_("Decrease CPU shares")}
                    plusBtnAriaLabel={_("Increase CPU shares")}
                    onChange={ev => this.onValueChanged('cpuShares', parseInt(ev.target.value) < 2 ? 2 : ev.target.value)}
                  />
                </Flex>
              </FormGroup>

              {dockerRestartAvailable &&
                <Grid hasGutter md={6} sm={3}>
                  <GridItem>
                    <FormGroup
                      fieldId='run-image-dialog-restart-policy'
                      label={_("Restart policy")}
                      labelIcon={
                        <Popover
                          aria-label={_("Restart policy help")}
                          enableFlip
                          bodyContent={_("Restart policy to follow when containers exit.")}
                        >
                          <button onClick={e => e.preventDefault()} className="pf-v5-c-form__group-label-help">
                            <OutlinedQuestionCircleIcon />
                          </button>
                        </Popover>
                      }
                    >
                      <FormSelect
                        id="run-image-dialog-restart-policy"
                        aria-label={_("Restart policy help")}
                        value={dialogValues.restartPolicy}
                        onChange={(_event, value) => this.onValueChanged('restartPolicy', value)}
                      >
                        <FormSelectOption value='always' key='always' label={_("Always")} />
                        <FormSelectOption value='no' key='no' label={_("No")} />
                        <FormSelectOption value='on-failure' key='on-failure' label={_("On failure")} />
                      </FormSelect>
                    </FormGroup>
                  </GridItem>

                  {dialogValues.restartPolicy === "on-failure" &&
                    <FormGroup fieldId='run-image-dialog-restart-retries' label={_("Maximum retries")}>
                      <NumberInput
                        id="run-image-dialog-restart-retries"
                        value={dialogValues.restartTries}
                        min={1}
                        max={65535}
                        widthChars={5}
                        minusBtnAriaLabel={_("Decrease maximum retries")}
                        plusBtnAriaLabel={_("Increase maximum retries")}
                        onMinus={() => this.onMinusOne('restartTries')}
                        onPlus={() => this.onPlusOne('restartTries')}
                        onChange={ev => this.onValueChanged('restartTries', parseInt(ev.target.value) < 1 ? 1 : ev.target.value)}
                      />
                    </FormGroup>
                  }
                </Grid>
              }
            </Tab>

            {/* Integration */}
            <Tab eventKey={2} title={<TabTitleText>{_("Integration")}</TabTitleText>} id="create-image-dialog-tab-integration" className="pf-v5-c-form">
              {this.state.prefillLoading && (
                <div className="pf-v5-c-helper-text pf-m-inline">
                  {_("Loading defaults from image…")}
                </div>
              )}

              <DynamicListForm
                key={`publish-${this.state.prefillNonce}`}
                id='run-image-dialog-publish'
                emptyStateString={_("No ports exposed")}
                formclass='publish-port-form'
                label={_("Port mapping")}
                actionLabel={_("Add port mapping")}
                validationFailed={dialogValues.validationFailed.publish}
                onValidationChange={value => this.dynamicListOnValidationChange('publish', value)}
                onChange={value => this.onValueChanged('publish', value)}
                value={dialogValues.publish}
                default={{ IP: null, containerPort: null, hostPort: null, protocol: 'tcp' }}
                itemcomponent={PublishPort}
                isDisabled={this.state.useHostNetwork}
                helperText={this.state.useHostNetwork
                  ? _("Host network is enabled; port mappings are ignored.")
                  : undefined}
              />

              <DynamicListForm
                key={`volumes-${this.state.prefillNonce}`}
                id='run-image-dialog-volume'
                emptyStateString={_("No volumes specified")}
                formclass='volume-form'
                label={_("Volumes")}
                actionLabel={_("Add volume")}
                validationFailed={dialogValues.validationFailed.volumes}
                onValidationChange={value => this.dynamicListOnValidationChange('volumes', value)}
                onChange={value => this.onValueChanged('volumes', value)}
                value={dialogValues.volumes}
                default={{ containerPath: null, hostPath: null, readOnly: false }}
                options={{ selinuxAvailable }}
                itemcomponent={Volume}
              />

              <DynamicListForm
                key={`env-${this.state.prefillNonce}`}
                id='run-image-dialog-env'
                emptyStateString={_("No environment variables specified")}
                formclass='env-form'
                label={_("Environment variables")}
                actionLabel={_("Add variable")}
                validationFailed={dialogValues.validationFailed.env}
                onValidationChange={value => this.dynamicListOnValidationChange('env', value)}
                onChange={value => this.onValueChanged('env', value)}
                value={dialogValues.env}
                default={{ envKey: null, envValue: null }}
                helperText={_("Paste one or more lines of key=value pairs into any field for bulk import")}
                itemcomponent={EnvVar}
              />
            </Tab>

            {/* Health check */}
            <Tab eventKey={3} title={<TabTitleText>{_("Health check")}</TabTitleText>} id="create-image-dialog-tab-healthcheck" className="pf-v5-c-form pf-m-horizontal">
              <FormGroup fieldId='run-image-dialog-healthcheck-command' label={_("Command")}>
                <TextInput
                  id='run-image-dialog-healthcheck-command'
                  value={dialogValues.healthcheck_command || ''}
                  onChange={(_, value) => this.onValueChanged('healthcheck_command', value)}
                />
              </FormGroup>

              <FormGroup fieldId="run-image-dialog-healthcheck-shell">
                <Checkbox
                  id="run-image-dialog-healthcheck-shell"
                  isChecked={dialogValues.healthcheck_shell}
                  label={_("In shell")}
                  onChange={(_event, checked) => this.onValueChanged('healthcheck_shell', checked)}
                />
              </FormGroup>

              <FormGroup
                fieldId='run-image-healthcheck-interval'
                label={_("Interval")}
                labelIcon={
                  <Popover
                    aria-label={_("Health check interval help")}
                    enableFlip
                    bodyContent={_("Interval how often health check is run.")}
                  >
                    <button onClick={e => e.preventDefault()} className="pf-v5-c-form__group-label-help">
                      <OutlinedQuestionCircleIcon />
                    </button>
                  </Popover>
                }
              >
                <InputGroup>
                  <NumberInput
                    id="run-image-healthcheck-interval"
                    value={dialogValues.healthcheck_interval}
                    min={0}
                    max={262144}
                    widthChars={6}
                    minusBtnAriaLabel={_("Decrease interval")}
                    plusBtnAriaLabel={_("Increase interval")}
                    onMinus={() => this.onMinusOne('healthcheck_interval')}
                    onPlus={() => this.onPlusOne('healthcheck_interval')}
                    onChange={ev => this.onValueChanged('healthcheck_interval', parseInt(ev.target.value) < 0 ? 0 : ev.target.value)}
                  />
                  <InputGroupText isPlain>{_("seconds")}</InputGroupText>
                </InputGroup>
              </FormGroup>

              <FormGroup
                fieldId='run-image-healthcheck-timeout'
                label={_("Timeout")}
                labelIcon={
                  <Popover
                    aria-label={_("Health check timeout help")}
                    enableFlip
                    bodyContent={_("The maximum time allowed to complete the health check before an interval is considered failed.")}
                  >
                    <button onClick={e => e.preventDefault()} className="pf-v5-c-form__group-label-help">
                      <OutlinedQuestionCircleIcon />
                    </button>
                  </Popover>
                }
              >
                <InputGroup>
                  <NumberInput
                    id="run-image-healthcheck-timeout"
                    value={dialogValues.healthcheck_timeout}
                    min={0}
                    max={262144}
                    widthChars={6}
                    minusBtnAriaLabel={_("Decrease timeout")}
                    plusBtnAriaLabel={_("Increase timeout")}
                    onMinus={() => this.onMinusOne('healthcheck_timeout')}
                    onPlus={() => this.onPlusOne('healthcheck_timeout')}
                    onChange={ev => this.onValueChanged('healthcheck_timeout', parseInt(ev.target.value) < 0 ? 0 : ev.target.value)}
                  />
                  <InputGroupText isPlain>{_("seconds")}</InputGroupText>
                </InputGroup>
              </FormGroup>

              <FormGroup
                fieldId='run-image-healthcheck-start-period'
                label={_("Start period")}
                labelIcon={
                  <Popover
                    aria-label={_("Health check start period help")}
                    enableFlip
                    bodyContent={_("The initialization time needed for a container to bootstrap.")}
                  >
                    <button onClick={e => e.preventDefault()} className="pf-v5-c-form__group-label-help">
                      <OutlinedQuestionCircleIcon />
                    </button>
                  </Popover>
                }
              >
                <InputGroup>
                  <NumberInput
                    id="run-image-healthcheck-start-period"
                    value={dialogValues.healthcheck_start_period}
                    min={0}
                    max={262144}
                    widthChars={6}
                    minusBtnAriaLabel={_("Decrease start period")}
                    plusBtnAriaLabel={_("Increase start period")}
                    onMinus={() => this.onMinusOne('healthcheck_start_period')}
                    onPlus={() => this.onPlusOne('healthcheck_start_period')}
                    onChange={ev => this.onValueChanged('healthcheck_start_period', parseInt(ev.target.value) < 0 ? 0 : ev.target.value)}
                  />
                  <InputGroupText isPlain>{_("seconds")}</InputGroupText>
                </InputGroup>
              </FormGroup>

              <FormGroup
                fieldId='run-image-healthcheck-retries'
                label={_("Retries")}
                labelIcon={
                  <Popover
                    aria-label={_("Health check retries help")}
                    enableFlip
                    bodyContent={_("The number of retries allowed before a healthcheck is considered to be unhealthy.")}
                  >
                    <button onClick={e => e.preventDefault()} className="pf-v5-c-form__group-label-help">
                      <OutlinedQuestionCircleIcon />
                    </button>
                  </Popover>
                }
              >
                <NumberInput
                  id="run-image-healthcheck-retries"
                  value={dialogValues.healthcheck_retries}
                  min={0}
                  max={999}
                  widthChars={3}
                  minusBtnAriaLabel={_("Decrease retries")}
                  plusBtnAriaLabel={_("Increase retries")}
                  onMinus={() => this.onMinusOne('healthcheck_retries')}
                  onPlus={() => this.onPlusOne('healthcheck_retries')}
                  onChange={ev => this.onValueChanged('healthcheck_retries', parseInt(ev.target.value) < 0 ? 0 : ev.target.value)}
                />
              </FormGroup>

              {version.localeCompare("4.3", undefined, { numeric: true, sensitivity: 'base' }) >= 0 &&
                <FormGroup
                  isInline
                  hasNoPaddingTop
                  fieldId='run-image-healthcheck-action'
                  label={_("When unhealthy")}
                  labelIcon={
                    <Popover
                      aria-label={_("Health failure check action help")}
                      enableFlip
                      bodyContent={_("Action to take once the container transitions to an unhealthy state.")}
                    >
                      <button onClick={e => e.preventDefault()} className="pf-v5-c-form__group-label-help">
                        <OutlinedQuestionCircleIcon />
                      </button>
                    </Popover>
                  }
                >
                  {HealthCheckOnFailureActionOrder.map(item =>
                    <Radio
                      value={item.value}
                      key={item.value}
                      label={item.label}
                      id={`run-image-healthcheck-action-${item.value}`}
                      isChecked={dialogValues.healthcheck_action === item.value}
                      onChange={() => this.onValueChanged('healthcheck_action', item.value)}
                    />
                  )}
                </FormGroup>
              }
            </Tab>
          </Tabs>
        </Form>
      </Modal>
    );
  }

  // Helpers used in render
  filterImages = () => {
    const { localImages } = this.props;
    const { imageResults, searchText } = this.state;
    const local = _("Local images");
    const images = { ...imageResults };

    let imageRegistries = [];
    if (this.state.searchByRegistry == 'local' || this.state.searchByRegistry == 'all') {
      imageRegistries.push(local);
      images[local] = localImages;

      if (this.state.searchByRegistry == 'all')
        imageRegistries = imageRegistries.concat(Object.keys(imageResults));
    } else {
      imageRegistries.push(this.state.searchByRegistry);
    }

    let regexString = searchText.replace(/[^\w_.:-]/g, "");
    if (regexString.includes('/')) {
      regexString = searchText.replace(searchText.split('/')[0], '');
    }
    const input = new RegExp(regexString, 'i');

    const results = imageRegistries
      .map((reg, index) => {
        const filtered = (reg in images ? images[reg] : [])
          .filter(image => image.Name.search(input) !== -1)
          .map((image, idx) => (
            <SelectOption
              key={idx}
              value={image}
              {...(image.Description && { description: image.Description })}
            />
          ));

        if (filtered.length === 0) {
          return [];
        } else {
          return (
            <SelectGroup label={reg} key={index} value={reg}>
              {filtered}
            </SelectGroup>
          );
        }
      })
      .filter(group => group.length !== 0);

    if (this.state.searchByRegistry !== 'all' && imageRegistries.length === 1 && results.length === 1) {
      return results[0].props.children;
    }

    return results;
  };

  truncateRegistryDomain = (domain) => {
    const parts = domain.split('.');
    if (parts.length > 2) {
      return parts[parts.length - 2] + "." + parts[parts.length - 1];
    }
    return domain;
  };
}

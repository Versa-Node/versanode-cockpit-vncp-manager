import React from 'react';
import { Badge } from "@patternfly/react-core/dist/esm/components/Badge";
import { Button } from "@patternfly/react-core/dist/esm/components/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider";
import { DropdownItem } from '@patternfly/react-core/dist/esm/components/Dropdown/index.js';
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex";
import { LabelGroup } from "@patternfly/react-core/dist/esm/components/Label";
import { Text, TextVariants } from "@patternfly/react-core/dist/esm/components/Text";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect";
import { Toolbar, ToolbarContent, ToolbarItem } from "@patternfly/react-core/dist/esm/components/Toolbar";
import { cellWidth, SortByDirection } from '@patternfly/react-table';

import cockpit from 'cockpit';
import { ListingTable } from "cockpit-components-table.jsx";
import { ListingPanel } from 'cockpit-components-listing-panel.jsx';
import ContainerDetails from './ContainerDetails.jsx';
import ContainerIntegration from './ContainerIntegration.jsx';
import ContainerTerminal from './ContainerTerminal.jsx';
import ContainerLogs from './ContainerLogs.jsx';
import ContainerHealthLogs from './ContainerHealthLogs.jsx';
import ContainerDeleteModal from './ContainerDeleteModal.jsx';
import ForceRemoveModal from './ForceRemoveModal.jsx';
import * as utils from './util.js';
import * as client from './client.js';
import ContainerCommitModal from './ContainerCommitModal.jsx';
import ContainerRenameModal from './ContainerRenameModal.jsx';
import { useDialogs, DialogsContext } from "dialogs.jsx";

import './Containers.scss';
import '@patternfly/patternfly/utilities/Accessibility/accessibility.css';
import { ImageRunModal } from './ImageRunModal.jsx';
import PruneUnusedContainersModal from './PruneUnusedContainersModal.jsx';

import { KebabDropdown } from "cockpit-components-dropdown.jsx";

const _ = cockpit.gettext;

/* ----------------------------- helpers ---------------------------- */

const VNCP_PFX = "io.versanode.vncp";

// Always produce the exact, human-friendly name (no leading "/" and never as array)
const getDisplayName = (c) => {
  const raw =
    (c && typeof c.Name === "string" && c.Name) ||
    (c && Array.isArray(c.Names) && c.Names[0]) ||
    "";
  return String(raw).replace(/^\/+/, "");
};

// Parse proxies strictly from JSON label io.versanode.vncp.proxies
// Expected formats:
//   - Array: [{slug, port, path?}, ...]
//   - Object: { "<slug>": {port, path?} | "<port>" }
function extractProxiesFromLabels(labels = {}) {
  const out = [];
  const j = labels?.[`${VNCP_PFX}.proxies`];
  if (!j) return out;
  try {
    const parsed = JSON.parse(j);
    if (Array.isArray(parsed)) {
      parsed.forEach(x => {
        if (!x) return;
        const slug = String(x.slug || "").trim();
        if (!slug) return;
        out.push({ slug });
      });
    } else if (typeof parsed === "object" && parsed) {
      Object.keys(parsed).forEach(slug => {
        const s = String(slug || "").trim();
        if (!s) return;
        out.push({ slug: s });
      });
    }
  } catch {
    // ignore malformed
  }
  // de-dup
  const seen = new Set();
  return out.filter(p => {
    if (seen.has(p.slug)) return false;
    seen.add(p.slug);
    return true;
  });
}

// Build scheme + hostname only, no port, no path
function buildPublicBase() {
  const { protocol, hostname } = window.location;
  // IPv6 literal needs brackets in URLs
  const host = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `${protocol}//${host}`;
}


/* -------------------------------------------------------------------------- */
/*                        Proxies-as-Links column                        */
/* -------------------------------------------------------------------------- */

const ProxyLinks = ({ container }) => {
  const labels = container?.Config?.Labels || {};
  const proxies = extractProxiesFromLabels(labels);
  if (!proxies.length) return <span>—</span>;

  const base = buildPublicBase();

  return (
    <LabelGroup isVertical>
      {proxies.map((p, idx) => {
        const href = `${base}/${encodeURIComponent(p.slug)}`;  // -> http(s)://<host>/<slug>
        return (
          <Button
            key={`${p.slug}-${idx}`}
            variant="link"
            isInline
            component="a"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {p.slug}
          </Button>
        );
      })}
    </LabelGroup>
  );
};


/* -------------------------------------------------------------------------- */
/*                               Container actions                            */
/* -------------------------------------------------------------------------- */

// Live CPU/Memory cell that updates while container is running
const LiveStats = ({ container, mode /* "cpu" | "mem" */ }) => {
  const [cpuText, setCpuText] = React.useState("");
  const [memText, setMemText] = React.useState("");

  const fmtBytes = (n = 0) => {
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    const u = ["B","KiB","MiB","GiB","TiB","PiB"];
    let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    const prec = n < 10 ? 2 : n < 100 ? 1 : 0;
    return `${n.toFixed(prec)} ${u[i]}`;
  };

  const calcCpuPercent = (v) => {
    try {
      const cpuDelta = (v?.cpu_stats?.cpu_usage?.total_usage ?? 0) -
                       (v?.precpu_stats?.cpu_usage?.total_usage ?? 0);
      const systemDelta = (v?.cpu_stats?.system_cpu_usage ?? 0) -
                          (v?.precpu_stats?.system_cpu_usage ?? 0);
      const online = v?.cpu_stats?.online_cpus ??
                     (v?.cpu_stats?.cpu_usage?.percpu_usage?.length ?? 1);
      if (cpuDelta > 0 && systemDelta > 0 && online > 0) {
        return (cpuDelta / systemDelta) * online * 100.0;
      }
    } catch {}
    return 0;
  };

  const calcMemText = (v) => {
    const ms = v?.memory_stats || {};
    const st = ms.stats || {};

    // cgroup v1: cache; cgroup v2: inactive_file (or total_inactive_file)
    const cacheLike =
      (st.cache ?? st.inactive_file ?? st.total_inactive_file ?? 0);

    // Some engines use usage_in_bytes
    const rawUsage = (ms.usage ?? ms.usage_in_bytes ?? 0);

    // Keep non-negative
    const usage = Math.max(0, rawUsage - cacheLike);

    // Limit may be 0/undefined or live under limit/max_usage on some engines
    const limit = (ms.limit ?? ms.max_usage ?? 0);

    return limit > 0 ? `${fmtBytes(usage)} / ${fmtBytes(limit)}` : fmtBytes(usage);
  };


  const paint = (stats) => {
    const cpu = calcCpuPercent(stats);
    const mem = calcMemText(stats);
    setCpuText(`${cpu.toFixed(2)}%`);
    setMemText(mem);
  };

  React.useEffect(() => {
    let closed = false;
    let streamHandle = null;
    let pollTimer = null;
    let streamStarted = false;
    let streamHasUpdate = false;
    let streamFallbackTimer = null;

    const id = container?.Id;
    const status = container?.State?.Status || "";

    if (!id || status !== "running") {
      setCpuText("");
      setMemText("");
      return () => {};
    }

    try {
      streamHandle = client.streamContainerStats(id, (chunk) => {
        if (closed || chunk == null) return;
        streamStarted = true;

        const handleOne = (obj) => {
          if (!obj || typeof obj !== "object") return;
          streamHasUpdate = true;
          paint(obj);
        };

        if (typeof chunk === "string") {
          chunk.trim().split(/\r?\n/).forEach(line => {
            if (!line) return;
            try {
              const obj = JSON.parse(line);
              handleOne(obj);
            } catch {}
          });
        } else if (typeof chunk === "object") {
          handleOne(chunk);
        }
      });
    } catch {}

    const startPolling = () => {
      if (closed) return;
      const tick = async () => {
        if (closed) return;
        try {
          const out = await cockpit.spawn(
            [
              "bash","-lc",
              `docker stats --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}' ${utils.quote_cmdline([id])}`
            ],
            { superuser: "try", err: "message" }
          );
          const line = (String(out || "").trim().split(/\r?\n/)[0] || "");
          const [cpuPercStr, memUsage] = line.split("|").map(s => (s || "").trim());
          if (cpuPercStr || memUsage) {
            const cpu = parseFloat(cpuPercStr.replace("%","")) || 0;
            setCpuText(`${cpu.toFixed(2)}%`);
            setMemText(memUsage || "");
          }
        } catch {}
      };
      tick();
      pollTimer = setInterval(tick, 2000);
    };

    streamFallbackTimer = setTimeout(() => {
      if (!streamStarted || !streamHasUpdate) startPolling();
    }, 1000);

    return () => {
      closed = true;
      try { streamHandle && streamHandle.close && streamHandle.close(); } catch {}
      if (pollTimer) clearInterval(pollTimer);
      if (streamFallbackTimer) clearTimeout(streamFallbackTimer);
    };
  }, [container?.Id, container?.State?.Status]);

  if (mode === "cpu") return cpuText ? <span>{cpuText}</span> : <span>—</span>;
  return memText ? <span>{memText}</span> : <span>—</span>;
};


const ContainerActions = ({ container, healthcheck, onAddNotification, localImages, updateContainer }) => {
  const Dialogs = useDialogs();
  const { version } = utils.useDockerInfo();
  const isRunning = container.State.Status === "running";
  const isPaused = container.State.Status === "paused";
  const isRestarting = container.State.Status === "restarting";

  const deleteContainer = (event) => {
    const name = getDisplayName(container);
    if (container.State.Status == "running") {
      const handleForceRemoveContainer = () => {
        const id = container ? container.Id : "";

        return client.delContainer(id, true)
          .catch(ex => {
            const error = cockpit.format(_("Failed to force remove container $0"), name);
            onAddNotification({ type: 'danger', error, errorDetail: ex.message });
            throw ex;
          })
          .finally(() => {
            Dialogs.close();
          });
      };

      Dialogs.show(<ForceRemoveModal name={name}
                                     handleForceRemove={handleForceRemoveContainer}
                                     reason={_("Deleting a running container will erase all data in it.")} />);
    } else {
      Dialogs.show(<ContainerDeleteModal containerWillDelete={container}
                                         onAddNotification={onAddNotification} />);
    }
  };

  const stopContainer = (force) => {
    const args = {};
    const name = getDisplayName(container);

    if (force)
      args.t = 0;
    client.postContainer("stop", container.Id, args)
      .catch(ex => {
        const error = cockpit.format(_("Failed to stop container $0"), name);
        onAddNotification({ type: 'danger', error, errorDetail: ex.message });
      });
  };

  const startContainer = () => {
    const name = getDisplayName(container);
    client.postContainer("start", container.Id, {})
      .catch(ex => {
        const error = cockpit.format(_("Failed to start container $0"), name);
        onAddNotification({ type: 'danger', error, errorDetail: ex.message });
      });
  };

  const resumeContainer = () => {
    const name = getDisplayName(container);
    client.postContainer("unpause", container.Id, {})
      .catch(ex => {
        const error = cockpit.format(_("Failed to resume container $0"), name);
        onAddNotification({ type: 'danger', error, errorDetail: ex.message });
      });
  };

  const pauseContainer = () => {
    const name = getDisplayName(container);
    client.postContainer("pause", container.Id, {})
      .catch(ex => {
        const error = cockpit.format(_("Failed to pause container $0"), name);
        onAddNotification({ type: 'danger', error, errorDetail: ex.message });
      });
  };

  const commitContainer = () => {
    Dialogs.show(<ContainerCommitModal container={container}
                                       localImages={localImages} />);
  };

  const restartContainer = (force) => {
    const args = {};
    const name = getDisplayName(container);

    if (force)
      args.t = 0;
    client.postContainer("restart", container.Id, args)
      .catch(ex => {
        const error = cockpit.format(_("Failed to restart container $0"), name);
        onAddNotification({ type: 'danger', error, errorDetail: ex.message });
      });
  };

  const renameContainer = () => {
    if (container.State.Status !== "running" ||
      version.localeCompare("3.0.1", undefined, { numeric: true, sensitivity: 'base' }) >= 0) {
      Dialogs.show(<ContainerRenameModal container={container}
                                         updateContainer={updateContainer} />);
    }
  };

  const addRenameAction = () => {
    actions.push(
      <DropdownItem key="rename"
                    onClick={() => renameContainer()}>
        {_("Rename")}
      </DropdownItem>
    );
  };

  const actions = [];
  if (isRunning || isPaused || isRestarting) {
    actions.push(
      <DropdownItem key="stop" onClick={() => stopContainer()}>{_("Stop")}</DropdownItem>,
      <DropdownItem key="force-stop" onClick={() => stopContainer(true)}>{_("Force stop")}</DropdownItem>,
      <DropdownItem key="restart" onClick={() => restartContainer()}>{_("Restart")}</DropdownItem>,
      <DropdownItem key="force-restart" onClick={() => restartContainer(true)}>{_("Force restart")}</DropdownItem>
    );

    if (!isPaused) {
      actions.push(<DropdownItem key="pause" onClick={() => pauseContainer()}>{_("Pause")}</DropdownItem>);
    } else {
      actions.push(<DropdownItem key="resume" onClick={() => resumeContainer()}>{_("Resume")}</DropdownItem>);
    }
  }

  if (!isRunning && !isPaused) {
    actions.push(<DropdownItem key="start" onClick={() => startContainer()}>{_("Start")}</DropdownItem>);
    actions.push(<Divider key="separator-0" />);
    if (version.localeCompare("3", undefined, { numeric: true, sensitivity: 'base' }) >= 0) addRenameAction();
  } else {
    actions.push(<Divider key="separator-0" />);
    if (version.localeCompare("3.0.1", undefined, { numeric: true, sensitivity: 'base' }) >= 0) addRenameAction();
  }

  actions.push(<Divider key="separator-1" />);
  actions.push(<DropdownItem key="commit" onClick={() => commitContainer()}>{_("Commit")}</DropdownItem>);

  actions.push(<Divider key="separator-2" />);
  actions.push(<DropdownItem key="delete" className="pf-m-danger" onClick={deleteContainer}>{_("Delete")}</DropdownItem>);

  return <KebabDropdown position="right" dropdownItems={actions} />;
};

export let onDownloadContainer = function funcOnDownloadContainer(container) {
  this.setState(prevState => ({
    downloadingContainers: [...prevState.downloadingContainers, container]
  }));
};

export let onDownloadContainerFinished = function funcOnDownloadContainerFinished(container) {
  this.setState(prevState => ({
    downloadingContainers: prevState.downloadingContainers.filter(entry => entry.name !== container.name),
  }));
};

const localize_health = (state) => {
  if (state === "healthy") return _("Healthy");
  else if (state === "unhealthy") return _("Unhealthy");
  else if (state === "starting") return _("Checking health");
  else console.error("Unexpected health check status", state);
  return null;
};

const ContainerOverActions = ({ handlePruneUnusedContainers, unusedContainers }) => {
  const actions = [
    <DropdownItem key="prune-unused-containers"
                  id="prune-unused-containers-button"
                  component="button"
                  className="pf-m-danger btn-delete"
                  onClick={() => handlePruneUnusedContainers()}
                  isDisabled={unusedContainers.length === 0}>
      {_("Prune unused containers")}
    </DropdownItem>,
  ];

  return <KebabDropdown toggleButtonId="containers-actions-dropdown" position="right" dropdownItems={actions} />;
};

class Containers extends React.Component {
  static contextType = DialogsContext;

  constructor(props) {
    super(props);
    this.state = {
      width: 0,
      downloadingContainers: [],
      showPruneUnusedContainersModal: false,
    };
    this.renderRow = this.renderRow.bind(this);
    this.onWindowResize = this.onWindowResize.bind(this);

    this.cardRef = React.createRef();

    onDownloadContainer = onDownloadContainer.bind(this);
    onDownloadContainerFinished = onDownloadContainerFinished.bind(this);

    window.addEventListener('resize', this.onWindowResize);
  }

  componentDidMount() {
    this.onWindowResize();
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.onWindowResize);
  }

  renderRow(containersStats, container, localImages) {
    const containerStats = containersStats[container.Id];
    const image = container.Config?.Image || container.Image;
    const isToolboxContainer = container.Config?.Labels?.["com.github.containers.toolbox"] === "true";
    const isDistroboxContainer = container.Config?.Labels?.manager === "distrobox";
    let localized_health = null;

    const healthcheck = container.State?.Health?.Status ?? container.State?.Healthcheck?.Status;
    const status = container.State?.Status ?? "";

    let proc_text = <LiveStats container={container} mode="cpu" cgroupVersion={this.props.cgroupVersion} />;
    let mem_text  = <LiveStats container={container} mode="mem" cgroupVersion={this.props.cgroupVersion} />;
    let proc = -1, mem = -1;
    if (containerStats && status === "running") {
      const [/*cpuText*/, cpuVal] = utils.format_cpu_usage(containerStats);
      const [/*memText*/, memVal] = utils.format_memory_and_limit(containerStats);
      proc = cpuVal ?? -1;
      mem  = memVal ?? -1;
    }

    const displayName = getDisplayName(container);

    const info_block = (
      <div className="container-block">
        <Flex alignItems={{ default: 'alignItemsCenter' }}>
          <span className="container-name">{displayName}</span>
          {isToolboxContainer && <Badge className='ct-badge-toolbox'>toolbox</Badge>}
          {isDistroboxContainer && <Badge className='ct-badge-distrobox'>distrobox</Badge>}
        </Flex>
        <small>{image.includes("sha256:") ? utils.truncate_id(image) : image}</small>
        <small>{utils.quote_cmdline(container.Config?.Cmd)}</small>
      </div>
    );

    let containerStateClass = "ct-badge-container-" + status.toLowerCase();
    if (container.isDownloading) containerStateClass += " downloading";

    const containerState = status.charAt(0).toUpperCase() + status.slice(1);

    const state = [<Badge key={containerState} isRead className={containerStateClass}>{_(containerState)}</Badge>];
    if (healthcheck) {
      localized_health = localize_health(healthcheck);
      if (localized_health)
        state.push(<Badge key={healthcheck} isRead className={"ct-badge-container-" + healthcheck}>{localized_health}</Badge>);
    }

    const columns = [
      { title: info_block, sortKey: displayName },
      { title: proc_text, props: { modifier: "nowrap" }, sortKey: containerState === "Running" ? (proc ?? -1) : -1 },
      { title: mem_text, props: { modifier: "nowrap" }, sortKey: mem ?? -1 },
      { title: <LabelGroup isVertical>{state}</LabelGroup>, sortKey: containerState },
      // Dashboards → Proxies column (base window URL + /slug, link name = slug)
      { title: <ProxyLinks container={container} />, sortKey: "" }
    ];

    if (!container.isDownloading) {
      columns.push({
        title: <ContainerActions container={container}
                                 healthcheck={healthcheck}
                                 onAddNotification={this.props.onAddNotification}
                                 localImages={localImages}
                                 updateContainer={this.props.updateContainer} />,
        props: { className: "pf-v5-c-table__action" }
      });
    } else {
      columns.push({ title: null });
    }

    const tty = !!container.Config?.Tty;

    const tabs = [];
    if (container.State) {
      tabs.push({
        name: _("Details"),
        renderer: ContainerDetails,
        data: { container }
      });

      if (!container.isDownloading) {
        tabs.push({
          name: _("Integration"),
          renderer: ContainerIntegration,
          data: { container, localImages }
        });
        tabs.push({
          name: _("Logs"),
          renderer: ContainerLogs,
          data: { containerId: container.Id, containerStatus: container.State.Status, width: this.state.width }
        });
        tabs.push({
          name: _("Console"),
          renderer: ContainerTerminal,
          data: { containerId: container.Id, containerStatus: container.State?.Status, width: this.state.width, tty }
        });
      }
    }

    if (healthcheck) {
      tabs.push({
        name: _("Health check"),
        renderer: ContainerHealthLogs,
        data: { container, onAddNotification: this.props.onAddNotification, state: localized_health }
      });
    }

    return {
      expandedContent: <ListingPanel colSpan='6' tabRenderers={tabs} />,
      columns,
      initiallyExpanded: document.location.hash.substr(1) === container.Id,
      props: {
        key: container.Id,
        "data-row-id": container.Id,
        "data-started-at": container.StartedAt,
      },
    };
  }

  onWindowResize() {
    this.setState({ width: this.cardRef.current.clientWidth });
  }

  onOpenPruneUnusedContainersDialog = () => {
    this.setState({ showPruneUnusedContainersModal: true });
  };

  render() {
    const Dialogs = this.context;
    const columnTitles = [
      { title: _("Container"), transforms: [cellWidth(20)], sortable: true },
      { title: _("CPU"), sortable: true },
      { title: _("Memory"), sortable: true },
      { title: _("State"), sortable: true },
      { title: _("Links") },
      ''
    ];
    let filtered = [];
    const unusedContainers = [];

    let emptyCaption = _("No containers");
    if (this.props.containers === null)
      emptyCaption = _("Loading...");
    else if (this.props.textFilter.length > 0)
      emptyCaption = _("No containers that match the current filter");
    else if (this.props.filter === "running")
      emptyCaption = _("No running containers");

    if (this.props.containers !== null) {
      filtered = Object.keys(this.props.containers).filter(id =>
        !(this.props.filter === "running") ||
        ["running", "restarting"].includes(this.props.containers[id].State?.Status)
      );

      const getHealth = id => {
        const state = this.props.containers[id]?.State;
        return state?.Health?.Status || state?.Healthcheck?.Status;
      };

      filtered.sort((a, b) => {
        const a_health = getHealth(a);
        const b_health = getHealth(b);
        if (a_health !== b_health) {
          if (a_health === "unhealthy") return -1;
          if (b_health === "unhealthy") return 1;
        }
        const aname = getDisplayName(this.props.containers[a]);
        const bname = getDisplayName(this.props.containers[b]);
        return aname > bname ? 1 : -1;
      });

      const prune_states = ["created", "configured", "stopped", "exited"];
      for (const containerid of Object.keys(this.props.containers)) {
        const container = this.props.containers[containerid];
        const st = (typeof container.State === "string")
          ? container.State
          : (container.State?.Status || "");
        if (!prune_states.includes(st))
          continue;

        unusedContainers.push({
          id: container.Id,
          name: getDisplayName(container),
          created: container.Created,
        });
      }
    }

    let localImages = null;
    let nonIntermediateImages = null;
    if (this.props.images) {
      localImages = Object.keys(this.props.images).map(id => {
        const img = this.props.images[id];
        img.Index = img.RepoTags?.[0] ? img.RepoTags[0].split('/')[0] : "";
        img.Name = utils.image_name(img);
        img.toString = function imgToString() { return this.Name };
        return img;
      }, []);
      nonIntermediateImages = localImages.filter(img => img.Index !== "");
    }

    const createContainer = (inPod) => {
      if (nonIntermediateImages)
        Dialogs.show(
          <utils.DockerInfoContext.Consumer>
            {(dockerInfo) => (
              <DialogsContext.Consumer>
                {(Dialogs) => (
                  <ImageRunModal user={this.props.user}
                                 localImages={nonIntermediateImages}
                                 serviceAvailable={this.props.serviceAvailable}
                                 onAddNotification={this.props.onAddNotification}
                                 dockerInfo={dockerInfo}
                                 dialogs={Dialogs} />
                )}
              </DialogsContext.Consumer>
            )}
          </utils.DockerInfoContext.Consumer>);
    };

    const filterRunning = (
      <Toolbar>
        <ToolbarContent className="containers-containers-toolbarcontent">
          <ToolbarItem variant="label" htmlFor="containers-containers-filter">
            {_("Show")}
          </ToolbarItem>
          <ToolbarItem>
            <FormSelect id="containers-containers-filter" value={this.props.filter} onChange={(_, value) => this.props.handleFilterChange(value)}>
              <FormSelectOption value='all' label={_("All")} />
              <FormSelectOption value='running' label={_("Only running")} />
            </FormSelect>
          </ToolbarItem>
          <ToolbarItem>
            <ContainerOverActions unusedContainers={unusedContainers} handlePruneUnusedContainers={this.onOpenPruneUnusedContainersDialog} />
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
    );

    const sortRows = (rows, direction, idx) => {
      const isNumeric = idx == 1 || idx == 2 || idx == 3;
      const stateOrderMapping = {};
      utils.states.forEach((elem, index) => {
        stateOrderMapping[elem] = index;
      });
      const sortedRows = rows.sort((a, b) => {
        let aitem = a.columns[idx].sortKey ?? a.columns[idx].title;
        let bitem = b.columns[idx].sortKey ?? b.columns[idx].title;
        if (idx === 3) {
          aitem = stateOrderMapping[aitem];
          bitem = stateOrderMapping[bitem];
        }
        if (isNumeric) {
          return bitem - aitem;
        } else {
          return (aitem || "").toString().localeCompare((bitem || "").toString());
        }
      });
      return direction === SortByDirection.asc ? sortedRows : sortedRows.reverse();
    };

    const card = (
      <Card id="containers-containers" className="containers-containers" isClickable isSelectable>
        <CardHeader actions={{ actions: filterRunning }}>
          <CardTitle><Text component={TextVariants.h2}>{_("Containers")}</Text></CardTitle>
        </CardHeader>
        <CardBody>
          <Flex direction={{ default: 'column' }}>
            {(this.props.containers === null)
              ? <ListingTable variant='compact'
                              aria-label={_("Containers")}
                              emptyCaption={emptyCaption}
                              columns={columnTitles}
                              sortMethod={sortRows}
                              rows={[]}
                              sortBy={{ index: 0, direction: SortByDirection.asc }} />
              : <Card key="table-containers"
                      id="table-containers"
                      isPlain
                      className="container-pod"
                      isClickable
                      isSelectable>
                  <ListingTable variant='compact'
                                emptyCaption={emptyCaption}
                                columns={columnTitles}
                                sortMethod={sortRows}
                                rows={filtered.map(container => {
                                  return this.renderRow(this.props.containersStats, this.props.containers[container],
                                                        localImages);
                                })}
                                aria-label={_("Containers")} />
                </Card>
            }
          </Flex>
          {this.state.showPruneUnusedContainersModal &&
            <PruneUnusedContainersModal
              close={() => this.setState({ showPruneUnusedContainersModal: false })}
              unusedContainers={unusedContainers}
              onAddNotification={this.props.onAddNotification}
              serviceAvailable={this.props.serviceAvailable}
              user={this.props.user} /> }
        </CardBody>
      </Card>
    );

    return <div ref={this.cardRef}>{card}</div>;
  }
}

export default Containers;

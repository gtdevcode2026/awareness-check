window.App = window.App || {};

App.ProjectStore = (() => {
  'use strict';

  async function ensureMigrated() {
    await App.DB.open();
    return App.DB.migrateDraftsToProjects();
  }

  function buildProjectFromWorkspace(workspace, metadata = {}, existing = null) {
    const now = new Date().toISOString();
    const version = (existing?.version || 0) + 1;
    const snapshots = Array.isArray(existing?.snapshots) ? [...existing.snapshots] : [];
    snapshots.push({
      version,
      capturedAt: now,
      workspace: workspace ? JSON.parse(JSON.stringify(workspace)) : null
    });
    return {
      projectId: existing?.projectId || `project_${Date.now()}`,
      title: metadata.title || existing?.title || 'Untitled Project',
      status: metadata.status || existing?.status || workspace?.workflow?.state || 'draft',
      owner: metadata.owner || existing?.owner || '',
      metadata: {
        issueDate: metadata.issueDate || existing?.metadata?.issueDate || '',
        campaignName: metadata.campaignName || existing?.metadata?.campaignName || '',
        audience: metadata.audience || existing?.metadata?.audience || ''
      },
      languageVariants: workspace?.variants || existing?.languageVariants || {},
      workflow: workspace?.workflow || existing?.workflow || null,
      version,
      snapshots,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
  }

  async function saveFromWorkspace(workspace, metadata = {}, projectId = null) {
    await ensureMigrated();
    const existing = projectId ? await App.DB.getProjectById(projectId) : null;
    const project = buildProjectFromWorkspace(workspace, metadata, existing);
    if (projectId) project.projectId = projectId;
    return App.DB.saveProject(project);
  }

  async function list() {
    await ensureMigrated();
    return App.DB.getAllProjects();
  }

  async function get(projectId) {
    await ensureMigrated();
    return App.DB.getProjectById(projectId);
  }

  async function remove(projectId) {
    await ensureMigrated();
    return App.DB.deleteProject(projectId);
  }

  // Poster template ids/format prefixes (mirrors the 'poster'/'poster-first'
  // tags in newsletter_builder.js CATALOG). Kept self-contained so the Projects
  // page can classify without loading the whole template catalog.
  const POSTER_IDS = new Set([
    'poster', 'poster1', 'poster2', 'poster3', 'poster4', 'poster5',
    'infographic', 'quicktips', 'redflags', 'stoplook'
  ]);

  // The template format of a project's most recent snapshot.
  function latestSnapshotFormat(record) {
    const snaps = Array.isArray(record && record.snapshots) ? record.snapshots : [];
    let best = null;
    for (const s of snaps) {
      if (!best || Number(s && s.version) > Number(best.version)) best = s;
    }
    return String((best && best.workspace && best.workspace.format) || '').trim();
  }

  // Pure: classify a record into 'advisory' | 'poster' | 'newsletter'. An explicit
  // `kind` (set on advisory records and any future stamped project) wins; otherwise
  // it is derived from the latest snapshot's template format.
  function classifyKind(record) {
    if (record && record.kind) return String(record.kind);
    const fmt = latestSnapshotFormat(record);
    if (fmt === 'advisory') return 'advisory';
    if (POSTER_IDS.has(fmt) || /^gen_/.test(fmt) || /^poster/.test(fmt)) return 'poster';
    return 'newsletter';
  }

  return {
    ensureMigrated, buildProjectFromWorkspace, saveFromWorkspace, list, get, remove,
    classifyKind, latestSnapshotFormat
  };
})();

(() => {
  const originalFetch = window.fetch.bind(window);
  const capabilityResponse = {
    configured: true,
    textModel: 'synthetic-browser-fixture',
    imageModel: 'synthetic-browser-fixture',
    providerLimitsVerifiedLive: false,
    note: 'Isolated browser fixture; no provider is configured or contacted.',
    operations: {},
  };

  const qa = {
    apiCalls: [],
    extractionStarted: false,
    extractionAborted: false,
    extractionRequest: null,
    releaseLateResponse: null,
    projectBaseline: null,
    workspacePreferenceBaseline: null,
  };

  qa.readProjects = async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('proactive_co_creator_db_v2');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const projects = await new Promise((resolve, reject) => {
      const request = db.transaction('projects', 'readonly').objectStore('projects').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return projects;
  };

  const sortKeys = (value) => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
    }
    return value;
  };

  qa.readState = async () => {
    const projects = await qa.readProjects();
    const projection = JSON.stringify(sortKeys(projects));
    const bytes = new TextEncoder().encode(projection);
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return {
      projectCount: projects.length,
      projects: projects.map((project) => ({
        id: project.id,
        revision: project.revision,
        persistedRevision: project.persistedRevision,
        manuscriptText: project.narrative?.sectionVersions?.[0]?.section?.text ?? null,
      })),
      projectionCharacters: projection.length,
      digest,
    };
  };

  qa.captureBaseline = async () => {
    qa.projectBaseline = await qa.readState();
    qa.workspacePreferenceBaseline = Object.fromEntries(
      Object.entries(localStorage).filter(([key]) => /workspace|mode/i.test(key)),
    );
    return {
      projectBaseline: qa.projectBaseline,
      workspacePreferenceBaseline: qa.workspacePreferenceBaseline,
    };
  };

  qa.assertUnchanged = async (stage) => {
    const state = await qa.readState();
    const preference = Object.fromEntries(
      Object.entries(localStorage).filter(([key]) => /workspace|mode/i.test(key)),
    );
    const sameDigest = state.digest === qa.projectBaseline?.digest;
    const samePreference = JSON.stringify(preference) === JSON.stringify(qa.workspacePreferenceBaseline);
    if (!sameDigest || !samePreference) {
      throw new Error(`${stage}: project or workspace preference changed`);
    }
    return { stage, sameDigest, samePreference, state, preference };
  };

  window.__pccImportQa = qa;
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    const method = init.method ?? (typeof input === 'object' ? input.method : 'GET') ?? 'GET';

    if (url.pathname === '/api/ai/capabilities') {
      qa.apiCalls.push({ path: url.pathname, method, mocked: true });
      return Promise.resolve(new Response(JSON.stringify(capabilityResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }

    if (url.pathname === '/api/narrative/import/extract') {
      qa.apiCalls.push({ path: url.pathname, method, mocked: true });
      qa.extractionStarted = true;
      try {
        qa.extractionRequest = JSON.parse(init.body ?? 'null');
      } catch {
        qa.extractionRequest = null;
      }
      init.signal?.addEventListener('abort', () => {
        qa.extractionAborted = true;
      }, { once: true });

      return new Promise((resolve) => {
        qa.releaseLateResponse = () => resolve(new Response(JSON.stringify({
          extraction: { findings: [], entities: [], relationships: [], ambiguities: [] },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      });
    }

    if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
      qa.apiCalls.push({ path: url.pathname, method, mocked: true, unexpected: true });
      return Promise.resolve(new Response(JSON.stringify({ error: { message: 'Unexpected API route in import cancellation test.' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }));
    }

    return originalFetch(input, init);
  };
})();
